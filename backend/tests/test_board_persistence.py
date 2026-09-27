from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_board_route_creates_database_and_returns_default_board():
    response = client.get("/api/board")

    assert response.status_code == 200
    data = response.json()
    assert data["columns"]
    assert data["cards"]
    assert "card-1" in data["cards"]


def test_board_route_persists_updates():
    payload = {
        "columns": [
            {"id": "col-1", "title": "To do", "cardIds": ["card-1"]},
            {"id": "col-2", "title": "Done", "cardIds": []},
        ],
        "cards": {
            "card-1": {
                "id": "card-1",
                "title": "Ship feature",
                "details": "Ship the MVP",
            }
        },
    }

    response = client.put("/api/board", json=payload)

    assert response.status_code == 200
    assert response.json()["cards"]["card-1"]["title"] == "Ship feature"

    saved = client.get("/api/board")
    assert saved.status_code == 200
    assert saved.json()["columns"][0]["title"] == "To do"
    assert saved.json()["cards"]["card-1"]["details"] == "Ship the MVP"


def test_board_route_rejects_invalid_payloads():
    response = client.put(
        "/api/board",
        json={"columns": [], "cards": "not-an-object"},
    )

    assert response.status_code == 422
