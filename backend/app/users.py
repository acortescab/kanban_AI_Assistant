import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

from app.database import get_connection, get_now_iso
from app.schemas import AdminUserModel, UserModel
from app.security import hash_password, new_token, verify_password
from app.service import ConflictError, create_board_in, delete_boards_of_user

SESSION_LIFETIME = timedelta(days=30)
STARTER_BOARD_TITLE = "My first board"

# Verified against when the username does not exist, so a failed login takes about as long
# whether or not the account exists.
_DUMMY_HASH = hash_password("not-a-real-password")


def _to_user(row: sqlite3.Row) -> UserModel:
    return UserModel(
        id=row["id"],
        username=row["username"],
        displayName=row["display_name"],
        role=row["role"],
        createdAt=row["created_at"],
    )


def _load_user(conn: sqlite3.Connection, user_id: str) -> UserModel:
    return _to_user(conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def create_user(username: str, password: str, display_name: str) -> UserModel:
    user_id = f"user-{uuid.uuid4().hex[:12]}"
    now = get_now_iso()
    with get_connection() as conn:
        taken = conn.execute(
            "SELECT 1 FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ).fetchone()
        if taken:
            raise ConflictError("That username is already taken.")
        conn.execute(
            "INSERT INTO users (id, username, password_hash, created_at, display_name, role) "
            "VALUES (?, ?, ?, ?, ?, 'user')",
            (user_id, username, hash_password(password), now, display_name.strip()),
        )
        create_board_in(conn, user_id, STARTER_BOARD_TITLE, "")
        return _load_user(conn, user_id)


def authenticate(username: str, password: str) -> UserModel | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,)
        ).fetchone()
    if row is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if not verify_password(password, row["password_hash"]):
        return None
    return _to_user(row)


def create_session(user_id: str) -> str:
    token = new_token()
    now = datetime.now(timezone.utc)
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now.isoformat(), (now + SESSION_LIFETIME).isoformat()),
        )
    return token


def get_session_user(token: str) -> UserModel | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT users.*, sessions.expires_at FROM sessions "
            "JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?",
            (token,),
        ).fetchone()
        if row is None:
            return None
        if row["expires_at"] <= get_now_iso():
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return None
    return _to_user(row)


def delete_session(token: str) -> None:
    with get_connection() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))


def update_display_name(user_id: str, display_name: str) -> UserModel:
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET display_name = ? WHERE id = ?", (display_name.strip(), user_id)
        )
        return _load_user(conn, user_id)


def change_password(user_id: str, current_password: str, new_password: str, keep_token: str) -> None:
    """Sets a new password and signs out every other session of this user."""
    with get_connection() as conn:
        stored = conn.execute(
            "SELECT password_hash FROM users WHERE id = ?", (user_id,)
        ).fetchone()["password_hash"]
        if not verify_password(current_password, stored):
            raise PermissionError("Current password is incorrect.")
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(new_password), user_id)
        )
        conn.execute(
            "DELETE FROM sessions WHERE user_id = ? AND token != ?", (user_id, keep_token)
        )


def check_password(user_id: str, password: str) -> bool:
    with get_connection() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    return row is not None and verify_password(password, row["password_hash"])


def delete_user(user_id: str) -> None:
    """Removes the user and everything they own. Children first: there is no cascade."""
    with get_connection() as conn:
        if conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
            raise LookupError("User not found")
        delete_boards_of_user(conn, user_id)
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


def list_users() -> list[AdminUserModel]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT users.*, (SELECT COUNT(*) FROM boards WHERE boards.user_id = users.id) AS board_count "
            "FROM users ORDER BY users.created_at, users.username"
        ).fetchall()
    return [
        AdminUserModel(**_to_user(row).model_dump(), boardCount=row["board_count"]) for row in rows
    ]


def set_role(user_id: str, role: str) -> UserModel:
    with get_connection() as conn:
        updated = conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id)).rowcount
        if not updated:
            raise LookupError("User not found")
        return _load_user(conn, user_id)
