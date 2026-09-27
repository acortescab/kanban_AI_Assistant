import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "kanban.db"


def get_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


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
                id TEXT PRIMARY KEY,
                board_id TEXT NOT NULL,
                column_key TEXT NOT NULL,
                title TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                FOREIGN KEY(board_id) REFERENCES boards(id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                board_id TEXT NOT NULL,
                column_id TEXT NOT NULL,
                title TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(board_id) REFERENCES boards(id),
                FOREIGN KEY(column_id) REFERENCES board_columns(id)
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
        conn.execute(
            "INSERT OR IGNORE INTO boards (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (board_id, user_id, "Project Board", created_at, created_at),
        )

        expected_column_ids = [
            "col-backlog",
            "col-discovery",
            "col-progress",
            "col-review",
            "col-done",
        ]
        legacy = conn.execute(
            "SELECT id FROM board_columns WHERE board_id = ? ORDER BY sort_order",
            (board_id,),
        ).fetchall()
        actual_column_ids = [row["id"] for row in legacy]

        needs_reset = set(actual_column_ids) != set(expected_column_ids)
        if needs_reset:
            conn.execute("DELETE FROM cards WHERE board_id = ?", (board_id,))
            conn.execute("DELETE FROM board_columns WHERE board_id = ?", (board_id,))

        default_columns = [
            ("col-backlog", "backlog", "Backlog", 0),
            ("col-discovery", "discovery", "Discovery", 1),
            ("col-progress", "progress", "In Progress", 2),
            ("col-review", "review", "Review", 3),
            ("col-done", "done", "Done", 4),
        ]

        for column_id, key, title, sort_order in default_columns:
            conn.execute(
                "INSERT OR IGNORE INTO board_columns (id, board_id, column_key, title, sort_order) VALUES (?, ?, ?, ?, ?)",
                (column_id, board_id, key, title, sort_order),
            )

        default_cards = {
            "card-1": {"title": "Align roadmap themes", "details": "Draft quarterly themes with impact statements and metrics.", "column_id": "col-backlog"},
            "card-2": {"title": "Gather customer signals", "details": "Review support tags, sales notes, and churn feedback.", "column_id": "col-backlog"},
            "card-3": {"title": "Prototype analytics view", "details": "Sketch initial dashboard layout and key drill-downs.", "column_id": "col-discovery"},
            "card-4": {"title": "Refine status language", "details": "Standardize column labels and tone across the board.", "column_id": "col-progress"},
            "card-5": {"title": "Design card layout", "details": "Add hierarchy and spacing for scanning dense lists.", "column_id": "col-progress"},
            "card-6": {"title": "QA micro-interactions", "details": "Verify hover, focus, and loading states.", "column_id": "col-review"},
            "card-7": {"title": "Ship marketing page", "details": "Final copy approved and asset pack delivered.", "column_id": "col-done"},
            "card-8": {"title": "Close onboarding sprint", "details": "Document release notes and share internally.", "column_id": "col-done"},
        }

        for card_id, card in default_cards.items():
            conn.execute(
                "INSERT OR IGNORE INTO cards (id, board_id, column_id, title, details, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    card_id,
                    board_id,
                    card["column_id"],
                    card["title"],
                    card["details"],
                    0,
                    created_at,
                    created_at,
                ),
            )

        if needs_reset:
            conn.execute(
                "UPDATE boards SET updated_at = ? WHERE id = ?",
                (get_now_iso(), board_id),
            )

        conn.commit()
