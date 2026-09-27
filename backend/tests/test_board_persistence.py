import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.database import _seed_board, get_connection, init_database
from app.main import app

client = TestClient(app)


def make_board(column_titles=None, backlog_card_ids=None, cards=None):
    column_ids = ["col-backlog", "col-discovery", "col-progress", "col-review", "col-done"]
    titles = column_titles or ["Backlog", "Discovery", "In Progress", "Review", "Done"]
    columns = [
        {"id": column_id, "title": title, "cardIds": []}
        for column_id, title in zip(column_ids, titles)
    ]
    columns[0]["cardIds"] = backlog_card_ids or []
    return {"columns": columns, "cards": cards or {}}


def test_board_route_returns_seeded_board():
    response = client.get("/api/board")

    assert response.status_code == 200
    data = response.json()
    assert [column["id"] for column in data["columns"]] == [
        "col-backlog",
        "col-discovery",
        "col-progress",
        "col-review",
        "col-done",
    ]
    assert data["columns"][0]["cardIds"] == ["card-1", "card-2"]
    assert data["columns"][2]["cardIds"] == ["card-4", "card-5"]
    assert len(data["cards"]) == 8


def test_board_route_persists_updates():
    payload = make_board(
        column_titles=["To do", "Discovery", "In Progress", "Review", "Done"],
        backlog_card_ids=["card-1"],
        cards={"card-1": {"id": "card-1", "title": "Ship feature", "details": "Ship the MVP"}},
    )

    response = client.put("/api/board", json=payload)

    assert response.status_code == 200
    assert response.json() == payload
    assert client.get("/api/board").json() == payload


def test_saved_board_survives_restart_without_reseeding():
    payload = make_board()
    assert client.put("/api/board", json=payload).status_code == 200

    init_database()

    assert client.get("/api/board").json() == payload


def test_save_keeps_column_keys():
    payload = make_board(column_titles=["A", "B", "C", "D", "E"])
    assert client.put("/api/board", json=payload).status_code == 200

    with get_connection() as conn:
        keys = [row["column_key"] for row in conn.execute("SELECT column_key FROM board_columns ORDER BY sort_order")]

    assert keys == ["backlog", "discovery", "progress", "review", "done"]


def test_another_board_can_reuse_column_and_card_ids():
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO users (id, username, created_at) VALUES ('user-2', 'other', 'now')"
        )
        conn.execute(
            "INSERT INTO boards (id, user_id, title, created_at, updated_at) VALUES ('board-2', 'user-2', 'Other', 'now', 'now')"
        )
        _seed_board(conn, "board-2", "now")

    assert len(client.get("/api/board").json()["cards"]) == 8


def test_board_route_rejects_invalid_payloads():
    response = client.put(
        "/api/board",
        json={"columns": [], "cards": "not-an-object"},
    )

    assert response.status_code == 422


def test_board_route_rejects_changed_columns():
    payload = make_board()
    payload["columns"] = payload["columns"][:2]

    response = client.put("/api/board", json=payload)

    assert response.status_code == 422
    assert len(client.get("/api/board").json()["columns"]) == 5


def test_saving_preserves_the_original_created_at_and_advances_updated_at():
    with get_connection() as conn:
        seeded_at = conn.execute(
            "SELECT created_at FROM cards WHERE id = 'card-1'"
        ).fetchone()["created_at"]

    payload = make_board(
        backlog_card_ids=["card-1", "card-2"],
        cards={
            "card-1": {"id": "card-1", "title": "Align roadmap themes", "details": ""},
            "card-2": {"id": "card-2", "title": "Gather customer signals", "details": ""},
        },
    )
    assert client.put("/api/board", json=payload).status_code == 200

    with get_connection() as conn:
        rows = {
            row["id"]: row
            for row in conn.execute(
                "SELECT id, created_at, updated_at FROM cards ORDER BY sort_order"
            )
        }

    assert rows["card-1"]["created_at"] == seeded_at
    assert rows["card-1"]["updated_at"] >= seeded_at


def test_a_new_card_gets_a_created_at():
    payload = make_board(
        backlog_card_ids=["card-1", "card-new"],
        cards={
            "card-1": {"id": "card-1", "title": "Align roadmap themes", "details": ""},
            "card-new": {"id": "card-new", "title": "Brand new", "details": ""},
        },
    )
    assert client.put("/api/board", json=payload).status_code == 200

    with get_connection() as conn:
        created_at = conn.execute(
            "SELECT created_at FROM cards WHERE id = 'card-new'"
        ).fetchone()["created_at"]

    assert created_at


def test_cards_cannot_reference_a_column_from_another_board():
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO boards (id, user_id, title, created_at, updated_at) "
            "VALUES ('board-2', 'user-1', 'Other', 'now', 'now')"
        )

    # col-review belongs to board-1, so a card on board-2 pointing at it must be rejected.
    with pytest.raises(sqlite3.IntegrityError):
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO cards (id, board_id, column_id, title, sort_order, created_at, updated_at) "
                "VALUES ('card-x', 'board-2', 'col-review', 'Bad', 0, 'now', 'now')"
            )


def test_board_route_returns_404_when_the_board_is_missing():
    # Children first: the foreign keys are enforced, so there is no cascade delete.
    with get_connection() as conn:
        conn.execute("DELETE FROM cards")
        conn.execute("DELETE FROM board_columns")
        conn.execute("DELETE FROM boards WHERE id = 'board-1'")

    response = client.get("/api/board")

    assert response.status_code == 404
    assert response.json()["detail"] == "Board not found"


def test_board_route_rejects_oversized_fields():
    payload = make_board(
        backlog_card_ids=["card-1"],
        cards={"card-1": {"id": "card-1", "title": "x" * 500, "details": ""}},
    )

    assert client.put("/api/board", json=payload).status_code == 422
