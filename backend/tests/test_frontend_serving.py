import pytest
from fastapi.testclient import TestClient

from app.main import STATIC_DIR, app

client = TestClient(app)


def test_health_route_is_available():
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


requires_build = pytest.mark.skipif(
    STATIC_DIR is None, reason="frontend not built (run npm run build in frontend/)"
)


@requires_build
def test_frontend_is_served_at_root():
    response = client.get("/")

    assert response.status_code == 200
    assert "Kanban" in response.text


@requires_build
def test_other_static_files_are_served():
    assert client.get("/favicon.ico").status_code == 200
    assert client.get("/does-not-exist").status_code == 404
    assert client.get("/api/health").json() == {"status": "ok"}
