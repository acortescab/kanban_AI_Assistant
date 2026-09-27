import json
from typing import Any

from pydantic import ValidationError

from app.openrouter_client import call_openrouter_messages
from app.schemas import AIChatRequestModel, AIChatResponseModel, BoardDataModel
from app.service import board_participants, read_board, save_board_record

MAX_HISTORY_MESSAGES = 20

RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "kanban_reply",
        # Advisory only. The generated schema leaves cardIds, details and board out
        # of "required" because they have defaults, so it is not valid for strict
        # structured outputs and OpenRouter may ignore it. The parser below, not
        # this parameter, is what keeps the flow working.
        "schema": AIChatResponseModel.model_json_schema(),
    },
}

SYSTEM_PROMPT = (
    "You are a project management assistant for a Kanban board. "
    "Respond with a single JSON object only. The object must have these keys: "
    '"response" (string) and "board" (either null or a full board replacement). '
    "If you change the board, return the complete board JSON. "
    "If you do not change the board, set board to null. "
    "Board rules: keep existing column ids unchanged; you may rename, reorder or add columns "
    '(new columns need a new unique id such as "col-<short-name>"), with at most 12 columns. '
    "Every card in cards must be listed in exactly one column's cardIds, every id in cardIds "
    "must exist in cards, and each key in cards must equal that card's id. "
    'Cards have: id, title, details, priority ("low", "medium" or "high"), '
    'dueDate ("YYYY-MM-DD" or null), labels (a list of short strings) and assigneeId '
    "(null or the id of one of the people on the board, listed below). "
    "You may add, edit, move and reorder cards, but you must never remove a card: "
    "keep every card id you were given. If the user asks for a card to be deleted, "
    "explain that they can remove it themselves with the card's delete button, and set "
    "board to null. "
    "Do not use markdown fences or any extra text."
)


def build_structured_ai_messages(
    request: AIChatRequestModel, board: BoardDataModel, people: dict[str, str] | None = None
) -> list[dict[str, str]]:
    board_json = json.dumps(board.model_dump(mode="json"), ensure_ascii=False, indent=2)
    people_json = json.dumps(people or {}, ensure_ascii=False)
    # The board JSON stays last: the e2e OpenRouter stub reads everything after its marker.
    system_message = {
        "role": "system",
        "content": (
            f"{SYSTEM_PROMPT}\n\nPeople on the board (assigneeId to name):\n{people_json}"
            f"\n\nCurrent board JSON:\n{board_json}"
        ),
    }
    history_messages = [
        message.model_dump() for message in request.history[-MAX_HISTORY_MESSAGES:]
    ]
    user_message = {"role": "user", "content": request.question.strip()}
    return [system_message, *history_messages, user_message]


def _strip_code_fences(content: str) -> str:
    stripped = content.strip()
    if not stripped.startswith("```"):
        return stripped

    stripped = stripped.removeprefix("```").strip()
    if stripped.startswith("json"):
        stripped = stripped[4:].strip()
    if stripped.endswith("```"):
        stripped = stripped[:-3].strip()
    return stripped


def _load_json_object(content: str) -> dict[str, Any]:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError:
        first_brace = content.find("{")
        last_brace = content.rfind("}")
        if first_brace == -1 or last_brace == -1 or last_brace <= first_brace:
            raise ValueError("AI response was not valid JSON.")
        payload = json.loads(content[first_brace : last_brace + 1])

    if not isinstance(payload, dict):
        raise ValueError("AI response must be a JSON object.")

    return payload


def parse_structured_ai_response(content: str) -> AIChatResponseModel:
    payload = _load_json_object(_strip_code_fences(content))

    response = payload.get("response")
    if not isinstance(response, str) or not response.strip():
        raise ValueError("AI response did not include a textual response.")

    board_payload = payload.get("board")
    board = None
    if board_payload is not None:
        try:
            board = BoardDataModel.model_validate(board_payload)
        except ValidationError as exc:
            raise ValueError("AI response included an invalid board update.") from exc

    return AIChatResponseModel(response=response, board=board)


def reject_removed_cards(board: BoardDataModel, sent_board: BoardDataModel) -> None:
    """Refuse a board that drops cards. Deleting is a user action, never the AI's."""
    removed = sorted(set(sent_board.cards) - set(board.cards))
    if removed:
        raise ValueError(
            "AI response tried to remove cards, which is not allowed: "
            + ", ".join(removed)
        )


def generate_structured_ai_response(
    request: AIChatRequestModel, user_id: str, board_id: str
) -> tuple[AIChatResponseModel, int]:
    """Returns the reply and the board version after it (unchanged when the AI edits nothing)."""
    board, version = read_board(user_id, board_id)
    messages = build_structured_ai_messages(request, board, board_participants(user_id, board_id))
    content = call_openrouter_messages(messages, response_format=RESPONSE_FORMAT)
    response = parse_structured_ai_response(content)

    if response.board is not None:
        reject_removed_cards(response.board, board)
        # The model call can take minutes. Saving against the version it read means an edit
        # someone made in the meantime is refused here instead of silently overwritten.
        version = save_board_record(
            user_id, board_id, response.board, expected_version=version, via_ai=True
        )

    return response, version