import copy
import json

import pytest

from app.ai_flow import (
    MAX_HISTORY_MESSAGES,
    RESPONSE_FORMAT,
    build_structured_ai_messages,
    parse_structured_ai_response,
)
from app.schemas import AIChatRequestModel, BoardDataModel, ChatMessageModel
from tests.conftest import DATA, DEMO_BOARD, fake_model

CHAT = f"{DEMO_BOARD}/ai/chat"


@pytest.fixture
def board(demo) -> dict:
    response = demo.get(DATA)
    assert response.status_code == 200
    return response.json()


def test_build_structured_ai_messages_includes_board_history_and_question(board):
    request = AIChatRequestModel(
        question="Move card-1 to Done",
        history=[
            ChatMessageModel(role="assistant", content="I can help with that."),
            ChatMessageModel(role="user", content="Please move the card."),
        ],
    )

    messages = build_structured_ai_messages(request, BoardDataModel.model_validate(board))

    assert messages[0]["role"] == "system"
    assert "Current board JSON" in messages[0]["content"]
    assert "Backlog" in messages[0]["content"]
    assert '"priority": "medium"' in messages[0]["content"]
    assert messages[1] == {"role": "assistant", "content": "I can help with that."}
    assert messages[2] == {"role": "user", "content": "Please move the card."}
    assert messages[-1] == {"role": "user", "content": "Move card-1 to Done"}


def test_board_json_in_the_prompt_serializes_due_dates(board):
    board["cards"]["card-1"]["dueDate"] = "2026-12-31"

    messages = build_structured_ai_messages(
        AIChatRequestModel(question="Hi"), BoardDataModel.model_validate(board)
    )

    assert '"dueDate": "2026-12-31"' in messages[0]["content"]


def test_build_structured_ai_messages_keeps_only_recent_history(board):
    history = [
        ChatMessageModel(role="user", content=f"message {index}") for index in range(30)
    ]
    request = AIChatRequestModel(question="Hi", history=history)

    messages = build_structured_ai_messages(request, BoardDataModel.model_validate(board))

    history_messages = messages[1:-1]
    assert len(history_messages) == MAX_HISTORY_MESSAGES
    assert history_messages[0]["content"] == "message 10"
    assert history_messages[-1]["content"] == "message 29"


def test_parse_structured_ai_response_accepts_valid_board_update(board):
    raw_response = json.dumps({"response": "I moved the card.", "board": board})

    parsed = parse_structured_ai_response(raw_response)

    assert parsed.response == "I moved the card."
    assert parsed.board is not None
    assert parsed.board.model_dump(mode="json") == board


def test_parse_structured_ai_response_accepts_a_reply_without_a_board():
    parsed = parse_structured_ai_response('{"response": "There are 8 cards.", "board": null}')

    assert parsed.response == "There are 8 cards."
    assert parsed.board is None


def test_parse_structured_ai_response_tolerates_fences_and_surrounding_text():
    fenced = '```json\n{"response": "Hi", "board": null}\n```'
    chatty = 'Sure! {"response": "Hi", "board": null} Hope that helps.'

    assert parse_structured_ai_response(fenced).response == "Hi"
    assert parse_structured_ai_response(chatty).response == "Hi"


@pytest.mark.parametrize(
    ("content", "message"),
    [
        ("no json here", "not valid JSON"),
        ("[1, 2]", "JSON object"),
        ('{"board": null}', "textual response"),
        ('{"response": "   ", "board": null}', "textual response"),
    ],
)
def test_parse_structured_ai_response_rejects_unusable_content(content, message):
    with pytest.raises(ValueError, match=message):
        parse_structured_ai_response(content)


def test_parse_structured_ai_response_rejects_malformed_board_update(board):
    board["cards"].pop("card-1")
    raw_response = json.dumps({"response": "I moved the card.", "board": board})

    with pytest.raises(ValueError, match="invalid board update"):
        parse_structured_ai_response(raw_response)


def test_parse_structured_ai_response_rejects_duplicate_column_ids(board):
    board["columns"][1]["id"] = board["columns"][0]["id"]
    raw_response = json.dumps({"response": "I renamed the column id.", "board": board})

    with pytest.raises(ValueError, match="invalid board update"):
        parse_structured_ai_response(raw_response)


def test_ai_chat_route_uses_saved_board_and_persists_valid_update(monkeypatch, demo, board):
    board["columns"][0]["title"] = "Saved title"
    assert demo.put(DATA, json=board).status_code == 200

    updated_board = copy.deepcopy(board)
    updated_board["columns"][0]["cardIds"].remove("card-1")
    updated_board["columns"][-1]["cardIds"].append("card-1")
    updated_board["cards"]["card-1"]["priority"] = "high"
    captured = fake_model(
        monkeypatch, {"response": "I moved card-1 to Done.", "board": updated_board}
    )

    response = demo.post(
        CHAT,
        json={
            "question": "Move card-1 to Done",
            "history": [{"role": "assistant", "content": "I can do that."}],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"response": "I moved card-1 to Done.", "board": updated_board}
    assert "Saved title" in captured["messages"][0]["content"]
    assert captured["response_format"] == RESPONSE_FORMAT
    assert demo.get(DATA).json() == updated_board


def test_ai_chat_route_works_on_the_requested_board_only(monkeypatch, demo, board):
    other_id = demo.post("/api/boards", json={"title": "Other"}).json()["id"]
    other_data = demo.get(f"/api/boards/{other_id}/data").json()
    updated_other = copy.deepcopy(other_data)
    updated_other["columns"][0]["title"] = "Changed by AI"
    captured = fake_model(monkeypatch, {"response": "Done.", "board": updated_other})

    response = demo.post(f"/api/boards/{other_id}/ai/chat", json={"question": "Rename"})

    assert response.status_code == 200
    assert "Align roadmap themes" not in captured["messages"][0]["content"]
    assert demo.get(f"/api/boards/{other_id}/data").json() == updated_other
    assert demo.get(DATA).json() == board


def test_ai_chat_route_returns_404_for_someone_elses_board(monkeypatch, alice, board):
    fake_model(monkeypatch, {"response": "Hi", "board": None})

    response = alice.post(CHAT, json={"question": "Hi"})

    assert response.status_code == 404


def test_ai_chat_route_reports_an_unreachable_model_as_503(monkeypatch, demo):
    def failing_call(messages, response_format=None):
        raise RuntimeError("OpenRouter is rate limited.")

    monkeypatch.setattr("app.ai_flow.call_openrouter_messages", failing_call)

    response = demo.post(CHAT, json={"question": "Hi"})

    assert response.status_code == 503
    assert response.json()["detail"] == "OpenRouter is rate limited."


def test_ai_chat_route_rejects_malformed_board_update(monkeypatch, demo, board):
    invalid_board = copy.deepcopy(board)
    invalid_board["cards"].pop("card-1")
    fake_model(monkeypatch, {"response": "I tried to move the card.", "board": invalid_board})

    response = demo.post(CHAT, json={"question": "Move card-1 to Done"})

    assert response.status_code == 502
    assert "invalid board update" in response.json()["detail"].lower()
    assert demo.get(DATA).json() == board


def test_ai_chat_route_rejects_client_supplied_board(demo, board):
    response = demo.post(CHAT, json={"question": "Hi", "history": [], "board": board})

    assert response.status_code == 422


def test_ai_chat_route_rejects_a_board_that_drops_cards(monkeypatch, demo, board):
    wiped_board = copy.deepcopy(board)
    for column in wiped_board["columns"]:
        column["cardIds"] = []
    wiped_board["cards"] = {}
    fake_model(monkeypatch, {"response": "I cleared the board.", "board": wiped_board})

    response = demo.post(CHAT, json={"question": "Delete everything"})

    assert response.status_code == 502
    assert "remove cards" in response.json()["detail"]
    assert demo.get(DATA).json() == board


def test_ai_chat_route_rejects_a_board_that_drops_a_single_card(monkeypatch, demo, board):
    lossy_board = copy.deepcopy(board)
    lossy_board["columns"][0]["cardIds"].remove("card-1")
    del lossy_board["cards"]["card-1"]
    fake_model(monkeypatch, {"response": "I tidied up.", "board": lossy_board})

    response = demo.post(CHAT, json={"question": "Remove card-1"})

    assert response.status_code == 502
    assert "card-1" in response.json()["detail"]
    assert demo.get(DATA).json() == board


def test_ai_chat_route_allows_adding_editing_moving_and_new_columns(monkeypatch, demo, board):
    added_board = copy.deepcopy(board)
    added_board["cards"]["card-9"] = {
        "id": "card-9",
        "title": "Write the summary",
        "details": "",
        "priority": "low",
        "dueDate": "2026-11-15",
        "labels": ["docs"],
        "assigneeId": "user-1",
    }
    added_board["columns"][0]["cardIds"].append("card-9")
    added_board["cards"]["card-1"]["title"] = "Renamed by the AI"
    added_board["columns"][2]["cardIds"].append(added_board["columns"][0]["cardIds"].pop(0))
    added_board["columns"][0]["title"] = "Icebox"
    added_board["columns"].append({"id": "col-blocked", "title": "Blocked", "cardIds": []})
    fake_model(monkeypatch, {"response": "I updated the board.", "board": added_board})

    response = demo.post(CHAT, json={"question": "Add and move a card"})

    assert response.status_code == 200
    assert demo.get(DATA).json() == added_board
