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
