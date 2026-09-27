import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.ai_flow import (
    MAX_HISTORY_MESSAGES,
    RESPONSE_FORMAT,
    build_structured_ai_messages,
    parse_structured_ai_response,
)
from app.main import app
from app.schemas import AIChatRequestModel, BoardDataModel, ChatMessageModel

client = TestClient(app)


def get_current_board() -> dict:
    response = client.get("/api/board")
    assert response.status_code == 200
    return response.json()


def fake_openrouter(monkeypatch, reply: dict) -> dict:
    captured = {}

    def fake_call_openrouter_messages(messages, response_format=None):
        captured["messages"] = messages
        captured["response_format"] = response_format
        return json.dumps(reply)

    monkeypatch.setattr("app.ai_flow.call_openrouter_messages", fake_call_openrouter_messages)
    return captured


def test_build_structured_ai_messages_includes_board_history_and_question():
    board = BoardDataModel.model_validate(get_current_board())
    request = AIChatRequestModel(
        question="Move card-1 to Done",
        history=[
            ChatMessageModel(role="assistant", content="I can help with that."),
            ChatMessageModel(role="user", content="Please move the card."),
        ],
    )

    messages = build_structured_ai_messages(request, board)

    assert messages[0]["role"] == "system"
    assert "Current board JSON" in messages[0]["content"]
    assert "Backlog" in messages[0]["content"]
    assert messages[1] == {"role": "assistant", "content": "I can help with that."}
    assert messages[2] == {"role": "user", "content": "Please move the card."}
    assert messages[-1] == {"role": "user", "content": "Move card-1 to Done"}


def test_build_structured_ai_messages_keeps_only_recent_history():
    board = BoardDataModel.model_validate(get_current_board())
    history = [
        ChatMessageModel(role="user", content=f"message {index}") for index in range(30)
    ]
    request = AIChatRequestModel(question="Hi", history=history)

    messages = build_structured_ai_messages(request, board)

    history_messages = messages[1:-1]
    assert len(history_messages) == MAX_HISTORY_MESSAGES
    assert history_messages[0]["content"] == "message 10"
    assert history_messages[-1]["content"] == "message 29"


def test_parse_structured_ai_response_accepts_valid_board_update():
    board = get_current_board()
    raw_response = json.dumps({"response": "I moved the card.", "board": board})

    parsed = parse_structured_ai_response(raw_response)

    assert parsed.response == "I moved the card."
    assert parsed.board is not None
    assert parsed.board.model_dump() == board


def test_parse_structured_ai_response_rejects_malformed_board_update():
    invalid_board = get_current_board()
    invalid_board["cards"].pop("card-1")
    raw_response = json.dumps({"response": "I moved the card.", "board": invalid_board})

    with pytest.raises(ValueError, match="invalid board update"):
        parse_structured_ai_response(raw_response)


def test_parse_structured_ai_response_rejects_changed_columns():
    board = get_current_board()
    board["columns"][0]["id"] = "col-todo"
    raw_response = json.dumps({"response": "I renamed the column id.", "board": board})

    with pytest.raises(ValueError, match="invalid board update"):
        parse_structured_ai_response(raw_response)


def test_ai_chat_route_uses_saved_board_and_persists_valid_update(monkeypatch):
    saved_board = get_current_board()
    saved_board["columns"][0]["title"] = "Saved title"
    assert client.put("/api/board", json=saved_board).status_code == 200

    updated_board = copy.deepcopy(saved_board)
    updated_board["columns"][0]["cardIds"].remove("card-1")
    updated_board["columns"][-1]["cardIds"].append("card-1")
    captured = fake_openrouter(
        monkeypatch, {"response": "I moved card-1 to Done.", "board": updated_board}
    )

    response = client.post(
        "/api/ai/chat",
        json={
            "question": "Move card-1 to Done",
            "history": [{"role": "assistant", "content": "I can do that."}],
        },
    )

    assert response.status_code == 200
    assert response.json() == {"response": "I moved card-1 to Done.", "board": updated_board}
    assert "Saved title" in captured["messages"][0]["content"]
    assert captured["response_format"] == RESPONSE_FORMAT
    assert get_current_board() == updated_board


def test_ai_chat_route_rejects_malformed_board_update(monkeypatch):
    original_board = get_current_board()
    invalid_board = copy.deepcopy(original_board)
    invalid_board["cards"].pop("card-1")
    fake_openrouter(monkeypatch, {"response": "I tried to move the card.", "board": invalid_board})

    response = client.post("/api/ai/chat", json={"question": "Move card-1 to Done"})

    assert response.status_code == 502
    assert "invalid board update" in response.json()["detail"].lower()
    assert get_current_board() == original_board


def test_ai_chat_route_rejects_client_supplied_board():
    response = client.post(
        "/api/ai/chat",
        json={"question": "Hi", "history": [], "board": get_current_board()},
    )

    assert response.status_code == 422


def test_ai_chat_route_rejects_a_board_that_drops_cards(monkeypatch):
    original_board = get_current_board()
    wiped_board = copy.deepcopy(original_board)
    for column in wiped_board["columns"]:
        column["cardIds"] = []
    wiped_board["cards"] = {}
    fake_openrouter(monkeypatch, {"response": "I cleared the board.", "board": wiped_board})

    response = client.post("/api/ai/chat", json={"question": "Delete everything"})

    assert response.status_code == 502
    assert "remove cards" in response.json()["detail"]
    assert get_current_board() == original_board


def test_ai_chat_route_rejects_a_board_that_drops_a_single_card(monkeypatch):
    original_board = get_current_board()
    lossy_board = copy.deepcopy(original_board)
    lossy_board["columns"][0]["cardIds"].remove("card-1")
    del lossy_board["cards"]["card-1"]
    fake_openrouter(monkeypatch, {"response": "I tidied up.", "board": lossy_board})

    response = client.post("/api/ai/chat", json={"question": "Remove card-1"})

    assert response.status_code == 502
    assert "card-1" in response.json()["detail"]
    assert get_current_board() == original_board


def test_ai_chat_route_allows_adding_renaming_and_moving(monkeypatch):
    saved_board = get_current_board()
    added_board = copy.deepcopy(saved_board)
    added_board["cards"]["card-9"] = {
        "id": "card-9",
        "title": "Write the summary",
        "details": "",
    }
    added_board["columns"][0]["cardIds"].append("card-9")
    added_board["cards"]["card-1"]["title"] = "Renamed by the AI"
    added_board["columns"][2]["cardIds"].append(added_board["columns"][0]["cardIds"].pop(0))
    added_board["columns"][0]["title"] = "Icebox"
    fake_openrouter(
        monkeypatch, {"response": "I updated the board.", "board": added_board}
    )

    response = client.post("/api/ai/chat", json={"question": "Add and move a card"})

    assert response.status_code == 200
    assert get_current_board() == added_board
