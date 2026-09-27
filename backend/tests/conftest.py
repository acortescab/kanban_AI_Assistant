import pytest
from fastapi.testclient import TestClient

from app import database, security
from app.main import app

DEMO_BOARD = "/api/boards/board-1"


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    # Real-strength scrypt costs tens of milliseconds per hash. Each hash stores its own
    # parameters, so a cheaper setting here still exercises the same code path.
    monkeypatch.setattr(security, "SCRYPT_N", 2**4)
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "kanban.db")
    database.init_database()


@pytest.fixture
def client() -> TestClient:
    """A client with no session."""
    return TestClient(app)


def signed_in_client(username: str, password: str) -> TestClient:
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return client


def registered_client(username: str, password: str = "password123", display_name: str = "") -> TestClient:
    client = TestClient(app)
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "displayName": display_name},
    )
    assert response.status_code == 201, response.text
    return client


@pytest.fixture
def demo() -> TestClient:
    """Signed in as the seeded demo admin, who owns board-1."""
    return signed_in_client("user", "password")


@pytest.fixture
def alice() -> TestClient:
    """A freshly registered regular user."""
    return registered_client("alice", display_name="Alice")
