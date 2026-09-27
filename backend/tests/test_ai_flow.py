import copy
import json

from fastapi.testclient import TestClient

from app.ai_flow import build_structured_ai_messages, parse_structured_ai_response
from app.main import app
from app.schemas import AIChatRequestModel, BoardDataModel, ChatMessageModel

client = TestClient(app)


def get_current_board() -> dict:
    response = client.get("/api/board")
    assert response.status_code == 200
    return response.json()


def test_build_structured_ai_messages_includes_board_history_and_question():
    board = BoardDataModel.model_validate(get_current_board())
    request = AIChatRequestModel(
        question="Move card-1 to Done",
        history=[
            ChatMessageModel(role="assistant", content="I can help with that."),
            ChatMessageModel(role="user", content="Please move the card."),
        ],
        board=board,
    )

    messages = build_structured_ai_messages(request)

    assert messages[0]["role"] == "system"
    assert "Current board JSON" in messages[0]["content"]
    assert "Backlog" in messages[0]["content"]
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "I can help with that."
    assert messages[2]["role"] == "user"
    assert messages[2]["content"] == "Please move the card."
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"] == "Move card-1 to Done"


def test_parse_structured_ai_response_accepts_valid_board_update():
    board = get_current_board()
    raw_response = json.dumps({
        "response": "I moved the card.",
        "board": board,
    })

    parsed = parse_structured_ai_response(raw_response)

    assert parsed.response == "I moved the card."
    assert parsed.board is not None
    assert parsed.board.model_dump() == board


def test_parse_structured_ai_response_rejects_malformed_board_update():
    board = get_current_board()
    invalid_board = copy.deepcopy(board)
    invalid_board["cards"].pop("card-1")

    raw_response = json.dumps({
        "response": "I moved the card.",
        "board": invalid_board,
    })

    try:
        parse_structured_ai_response(raw_response)
        raise AssertionError("Expected ValueError for malformed board output.")
    except ValueError as exc:
        assert "invalid board update" in str(exc).lower()


def test_ai_chat_route_persists_valid_board_update(monkeypatch):
    original_board = get_current_board()
    updated_board = copy.deepcopy(original_board)
    updated_board["columns"][0]["cardIds"] = [
        card_id for card_id in updated_board["columns"][0]["cardIds"] if card_id != "card-1"
    ]
    updated_board["columns"][-1]["cardIds"].append("card-1")

    captured_messages = {}

    def fake_call_openrouter_messages(messages):
        captured_messages["messages"] = messages
        return json.dumps({
            "response": "I moved card-1 to Done.",
            "board": updated_board,
        })

    monkeypatch.setattr("app.ai_flow.call_openrouter_messages", fake_call_openrouter_messages)

    request_body = {
        "question": "Move card-1 to Done",
        "history": [
            {"role": "assistant", "content": "I can do that."},
            {"role": "user", "content": "Please move it."},
        ],
        "board": original_board,
    }

    try:
        response = client.post("/api/ai/chat", json=request_body)

        assert response.status_code == 200
        body = response.json()
        assert body["response"] == "I moved card-1 to Done."
        assert body["board"]["columns"][-1]["cardIds"][-1] == "card-1"
        assert captured_messages["messages"][0]["role"] == "system"

        saved_board = get_current_board()
        assert saved_board["columns"][-1]["cardIds"][-1] == "card-1"
    finally:
        restore_response = client.put("/api/board", json=original_board)
        assert restore_response.status_code == 200


def test_ai_chat_route_rejects_malformed_board_update(monkeypatch):
    original_board = get_current_board()
    invalid_board = copy.deepcopy(original_board)
    invalid_board["cards"].pop("card-1")

    def fake_call_openrouter_messages(_messages):
        return json.dumps({
            "response": "I tried to move the card.",
            "board": invalid_board,
        })

    monkeypatch.setattr("app.ai_flow.call_openrouter_messages", fake_call_openrouter_messages)

    request_body = {
        "question": "Move card-1 to Done",
        "history": [],
        "board": original_board,
    }

    try:
        response = client.post("/api/ai/chat", json=request_body)

        assert response.status_code == 502
        assert "invalid board update" in response.json()["detail"].lower()
        assert get_current_board() == original_board
    finally:
        restore_response = client.put("/api/board", json=original_board)
        assert restore_response.status_code == 200