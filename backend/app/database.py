import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.security import hash_password

DB_PATH = Path(os.getenv("KANBAN_DB_PATH", Path(__file__).resolve().parent / "kanban.db"))

DEMO_USER_ID = "user-1"
DEMO_BOARD_ID = "board-1"


def get_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Yields a connection that commits on success, rolls back on error, and always closes."""
    conn = sqlite3.connect(DB_PATH)
    # SQLite ignores foreign keys unless this is turned on for every connection.
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        created_at TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS boards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS board_members (
        board_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY(board_id, user_id),
        FOREIGN KEY(board_id) REFERENCES boards(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
    """,
    # The actor is stored by name, not as a foreign key, so history outlives deleted accounts.
    """
    CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(board_id) REFERENCES boards(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS board_columns (
        id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        column_key TEXT NOT NULL,
        title TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY(board_id, id),
        FOREIGN KEY(board_id) REFERENCES boards(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS cards (
        id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        title TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        due_date TEXT,
        labels TEXT NOT NULL DEFAULT '[]',
        assignee_id TEXT,
        PRIMARY KEY(board_id, id),
        FOREIGN KEY(board_id) REFERENCES boards(id),
        FOREIGN KEY(board_id, column_id) REFERENCES board_columns(board_id, id)
    )
    """,
]

# Columns added after the MVP. CREATE TABLE IF NOT EXISTS leaves an existing table alone,
# so databases created before these existed get them added here.
ADDED_COLUMNS = {
    "users": {
        "display_name": "TEXT NOT NULL DEFAULT ''",
        "role": "TEXT NOT NULL DEFAULT 'user'",
    },
    "boards": {
        "description": "TEXT NOT NULL DEFAULT ''",
        "version": "INTEGER NOT NULL DEFAULT 0",
    },
    "cards": {
        "priority": "TEXT NOT NULL DEFAULT 'medium'",
        "due_date": "TEXT",
        "labels": "TEXT NOT NULL DEFAULT '[]'",
        "assignee_id": "TEXT",
    },
}


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    for table, columns in ADDED_COLUMNS.items():
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, definition in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")


def init_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        for statement in SCHEMA:
            conn.execute(statement)
        _add_missing_columns(conn)

        created_at = get_now_iso()
        demo_user = conn.execute(
            "SELECT password_hash FROM users WHERE id = ?", (DEMO_USER_ID,)
        ).fetchone()
        if demo_user is None:
            conn.execute(
                "INSERT INTO users (id, username, password_hash, created_at, display_name, role) "
                "VALUES (?, 'user', ?, ?, 'Demo User', 'admin')",
                (DEMO_USER_ID, hash_password("password"), created_at),
            )
            # Seeded once with the user, so a board the demo user deletes stays deleted.
            conn.execute(
                "INSERT INTO boards (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (DEMO_BOARD_ID, DEMO_USER_ID, "Project Board", created_at, created_at),
            )
            _seed_board(conn, DEMO_BOARD_ID, created_at)
        elif demo_user["password_hash"] is None:
            # MVP databases stored the demo user without a password (login was frontend-only).
            conn.execute(
                "UPDATE users SET password_hash = ?, role = 'admin' WHERE id = ?",
                (hash_password("password"), DEMO_USER_ID),
            )


SEED_COLUMNS = [
    ("col-backlog", "backlog", "Backlog", [
        ("card-1", "Align roadmap themes", "Draft quarterly themes with impact statements and metrics."),
        ("card-2", "Gather customer signals", "Review support tags, sales notes, and churn feedback."),
    ]),
    ("col-discovery", "discovery", "Discovery", [
        ("card-3", "Prototype analytics view", "Sketch initial dashboard layout and key drill-downs."),
    ]),
    ("col-progress", "progress", "In Progress", [
        ("card-4", "Refine status language", "Standardize column labels and tone across the board."),
        ("card-5", "Design card layout", "Add hierarchy and spacing for scanning dense lists."),
    ]),
    ("col-review", "review", "Review", [
        ("card-6", "QA micro-interactions", "Verify hover, focus, and loading states."),
    ]),
    ("col-done", "done", "Done", [
        ("card-7", "Ship marketing page", "Final copy approved and asset pack delivered."),
        ("card-8", "Close onboarding sprint", "Document release notes and share internally."),
    ]),
]


def _seed_board(conn: sqlite3.Connection, board_id: str, created_at: str) -> None:
    for column_order, (column_id, key, title, cards) in enumerate(SEED_COLUMNS):
        conn.execute(
            "INSERT INTO board_columns (id, board_id, column_key, title, sort_order) VALUES (?, ?, ?, ?, ?)",
            (column_id, board_id, key, title, column_order),
        )
        for card_order, (card_id, card_title, details) in enumerate(cards):
            conn.execute(
                "INSERT INTO cards (id, board_id, column_id, title, details, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (card_id, board_id, column_id, card_title, details, card_order, created_at, created_at),
            )
