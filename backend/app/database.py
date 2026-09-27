import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(os.getenv("KANBAN_DB_PATH", Path(__file__).resolve().parent / "kanban.db"))


def get_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Yields a connection that commits on success, rolls back on error, and always closes."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS boards (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        conn.execute(
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
            """
        )
        conn.execute(
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
                PRIMARY KEY(board_id, id),
                FOREIGN KEY(board_id) REFERENCES boards(id),
                FOREIGN KEY(board_id, column_id) REFERENCES board_columns(board_id, id)
            )
            """
        )

        user_id = "user-1"
        username = "user"
        created_at = get_now_iso()
        conn.execute(
            "INSERT OR IGNORE INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (user_id, username, None, created_at),
        )

        board_id = "board-1"
        board_created = conn.execute(
            "INSERT OR IGNORE INTO boards (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (board_id, user_id, "Project Board", created_at, created_at),
        ).rowcount
        if board_created:
            _seed_board(conn, board_id, created_at)


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
