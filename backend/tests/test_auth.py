import sqlite3
from datetime import datetime, timedelta, timezone

import pytest

from app import database
from app.main import SESSION_COOKIE
from app.security import hash_password, verify_password
from tests.conftest import registered_client, signed_in_client


def test_password_hashes_are_salted_and_verifiable():
    first = hash_password("secret-pass")
    second = hash_password("secret-pass")

    assert first != second
    assert verify_password("secret-pass", first)
    assert not verify_password("wrong-pass", first)
    assert not verify_password("secret-pass", None)


def test_demo_user_is_seeded_as_admin(demo):
    me = demo.get("/api/auth/me").json()

    assert me["username"] == "user"
    assert me["role"] == "admin"
    assert me["displayName"] == "Demo User"


def test_login_sets_an_http_only_session_cookie(client):
    response = client.post("/api/auth/login", json={"username": "user", "password": "password"})

    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{SESSION_COOKIE}=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie


@pytest.mark.parametrize(
    ("username", "password"),
    [("user", "wrong"), ("nobody", "password"), ("USER", "wrong")],
)
def test_login_rejects_bad_credentials_with_one_message(client, username, password):
    response = client.post("/api/auth/login", json={"username": username, "password": password})

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid username or password."


def test_login_is_case_insensitive_on_username(client):
    response = client.post("/api/auth/login", json={"username": "USER", "password": "password"})

    assert response.status_code == 200


def test_me_requires_a_session(client):
    assert client.get("/api/auth/me").status_code == 401


def test_an_unknown_session_token_is_rejected(client):
    client.cookies.set(SESSION_COOKIE, "made-up")

    assert client.get("/api/auth/me").status_code == 401


def test_an_expired_session_is_rejected_and_removed(demo):
    token = demo.cookies[SESSION_COOKIE]
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    with database.get_connection() as conn:
        conn.execute("UPDATE sessions SET expires_at = ? WHERE token = ?", (past, token))

    assert demo.get("/api/auth/me").status_code == 401
    with database.get_connection() as conn:
        assert conn.execute("SELECT 1 FROM sessions WHERE token = ?", (token,)).fetchone() is None


def test_register_signs_in_and_creates_a_starter_board(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "bob", "password": "password123", "displayName": "  Bob  "},
    )

    assert response.status_code == 201
    user = response.json()
    assert user["username"] == "bob"
    assert user["displayName"] == "Bob"
    assert user["role"] == "user"
    assert client.get("/api/auth/me").json() == user

    boards = client.get("/api/boards").json()
    assert [board["title"] for board in boards] == ["My first board"]
    data = client.get(f"/api/boards/{boards[0]['id']}/data").json()
    assert [column["title"] for column in data["columns"]] == [
        "Backlog",
        "Discovery",
        "In Progress",
        "Review",
        "Done",
    ]
    assert data["cards"] == {}


def test_register_rejects_a_taken_username_regardless_of_case(client, alice):
    response = client.post(
        "/api/auth/register", json={"username": "ALICE", "password": "password123"}
    )

    assert response.status_code == 409
    assert "taken" in response.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"username": "ab", "password": "password123"},
        {"username": "has space", "password": "password123"},
        {"username": "x" * 33, "password": "password123"},
        {"username": "carol", "password": "short"},
        {"username": "carol", "password": "password123", "role": "admin"},
    ],
)
def test_register_validates_input(client, payload):
    assert client.post("/api/auth/register", json=payload).status_code == 422


def test_logout_ends_the_session(demo):
    assert demo.post("/api/auth/logout").status_code == 204

    assert demo.get("/api/auth/me").status_code == 401
    with database.get_connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_logout_without_a_session_is_harmless(client):
    assert client.post("/api/auth/logout").status_code == 204


def test_update_display_name(alice):
    response = alice.patch("/api/auth/me", json={"displayName": " Alice Smith "})

    assert response.status_code == 200
    assert response.json()["displayName"] == "Alice Smith"
    assert alice.get("/api/auth/me").json()["displayName"] == "Alice Smith"


def test_profile_update_cannot_change_role(alice):
    response = alice.patch("/api/auth/me", json={"displayName": "A", "role": "admin"})

    assert response.status_code == 422
    assert alice.get("/api/auth/me").json()["role"] == "user"


def test_change_password_requires_the_current_password(alice):
    response = alice.post(
        "/api/auth/password",
        json={"currentPassword": "wrong-password", "newPassword": "new-password-1"},
    )

    assert response.status_code == 400
    signed_in_client("alice", "password123")


def test_change_password_signs_out_other_sessions_only(alice):
    other_device = signed_in_client("alice", "password123")

    response = alice.post(
        "/api/auth/password",
        json={"currentPassword": "password123", "newPassword": "new-password-1"},
    )

    assert response.status_code == 204
    assert alice.get("/api/auth/me").status_code == 200
    assert other_device.get("/api/auth/me").status_code == 401
    signed_in_client("alice", "new-password-1")


def test_new_password_must_be_long_enough(alice):
    response = alice.post(
        "/api/auth/password", json={"currentPassword": "password123", "newPassword": "short"}
    )

    assert response.status_code == 422


def test_delete_account_requires_the_password(alice):
    response = alice.request("DELETE", "/api/auth/me", json={"password": "wrong-password"})

    assert response.status_code == 400
    assert alice.get("/api/auth/me").status_code == 200


def test_delete_account_removes_the_user_and_their_boards(alice, client):
    board_id = alice.get("/api/boards").json()[0]["id"]

    response = alice.request("DELETE", "/api/auth/me", json={"password": "password123"})

    assert response.status_code == 204
    assert alice.get("/api/auth/me").status_code == 401
    login = client.post("/api/auth/login", json={"username": "alice", "password": "password123"})
    assert login.status_code == 401
    with database.get_connection() as conn:
        assert conn.execute("SELECT 1 FROM boards WHERE id = ?", (board_id,)).fetchone() is None
        assert conn.execute("SELECT COUNT(*) FROM board_columns WHERE board_id = ?", (board_id,)).fetchone()[0] == 0


def test_the_only_admin_cannot_delete_their_account(demo):
    response = demo.request("DELETE", "/api/auth/me", json={"password": "password"})

    assert response.status_code == 409
    assert demo.get("/api/auth/me").status_code == 200


def test_an_admin_can_delete_their_account_when_another_admin_exists(demo, alice):
    alice_id = alice.get("/api/auth/me").json()["id"]
    assert demo.patch(f"/api/admin/users/{alice_id}", json={"role": "admin"}).status_code == 200

    response = demo.request("DELETE", "/api/auth/me", json={"password": "password"})

    assert response.status_code == 204


def test_a_username_can_be_reused_after_the_account_is_deleted(alice):
    alice.request("DELETE", "/api/auth/me", json={"password": "password123"})

    registered_client("alice")


def test_mvp_databases_are_migrated(tmp_path, monkeypatch):
    """A database from the MVP has no sessions table, no new columns, and no password."""
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
            password_hash TEXT, created_at TEXT NOT NULL);
        CREATE TABLE boards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE board_columns (id TEXT PRIMARY KEY, board_id TEXT NOT NULL,
            column_key TEXT NOT NULL, title TEXT NOT NULL, sort_order INTEGER NOT NULL);
        CREATE TABLE cards (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, column_id TEXT NOT NULL,
            title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT INTO users VALUES ('user-1', 'user', NULL, 'then');
        INSERT INTO boards VALUES ('board-1', 'user-1', 'Project Board', 'then', 'then');
        INSERT INTO board_columns VALUES ('col-backlog', 'board-1', 'backlog', 'Backlog', 0);
        INSERT INTO cards VALUES ('card-1', 'board-1', 'col-backlog', 'Old card', '', 0, 'then', 'then');
        """
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(database, "DB_PATH", db_path)

    database.init_database()

    demo = signed_in_client("user", "password")
    assert demo.get("/api/auth/me").json()["role"] == "admin"
    data = demo.get("/api/boards/board-1/data").json()
    assert data["cards"]["card-1"] == {
        "id": "card-1",
        "title": "Old card",
        "details": "",
        "priority": "medium",
        "dueDate": None,
        "labels": [],
        "assigneeId": None,
    }
    # A second user's board must not collide with the old single-column primary keys.
    alice = registered_client("alice")
    assert len(alice.get("/api/boards").json()) == 1
