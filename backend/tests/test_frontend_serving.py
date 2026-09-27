from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_frontend_and_health_routes_are_available():
    root_response = client.get("/")
    health_response = client.get("/api/health")

    assert root_response.status_code == 200
    assert "Kanban" in root_response.text
    assert health_response.status_code == 200
    assert health_response.json() == {"status": "ok"}
