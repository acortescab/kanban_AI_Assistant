import json
import sqlite3
import uuid

from app import activity
from app.database import get_connection, get_now_iso
from app.schemas import (
    ActivityModel,
    BoardDataModel,
    BoardMemberModel,
    BoardSummaryModel,
    CardModel,
    ColumnModel,
)

DEFAULT_COLUMN_TITLES = ["Backlog", "Discovery", "In Progress", "Review", "Done"]

BOARD_NOT_FOUND = "Board not found"
OWNER_ONLY = "Only the board owner can do that."


class ConflictError(Exception):
    """The request clashes with existing state, such as a taken username."""


class VersionConflictError(ConflictError):
    """The board changed since the version the caller based its change on."""


class InvalidBoardError(ValueError):
    """The board is well formed but refers to something it may not, like a non-member."""


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def _name_of(conn: sqlite3.Connection, user_id: str) -> str:
    row = conn.execute("SELECT username, display_name FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["display_name"] or row["username"]


def _participants(conn: sqlite3.Connection, board_id: str) -> dict[str, str]:
    """User id to display name for the board's owner and members."""
    rows = conn.execute(
        "SELECT id, username, display_name FROM users WHERE id = (SELECT user_id FROM boards WHERE id = ?) "
        "OR id IN (SELECT user_id FROM board_members WHERE board_id = ?)",
        (board_id, board_id),
    ).fetchall()
    return {row["id"]: row["display_name"] or row["username"] for row in rows}


def _unassign(conn: sqlite3.Connection, board_id: str, user_id: str) -> None:
    """Clears a departing member's cards. It changes board data, so the version moves on and
    clients holding the old assignments must reload before they can save."""
    cleared = conn.execute(
        "UPDATE cards SET assignee_id = NULL WHERE board_id = ? AND assignee_id = ?",
        (board_id, user_id),
    ).rowcount
    if cleared:
        conn.execute("UPDATE boards SET version = version + 1 WHERE id = ?", (board_id,))


def _require_board(conn: sqlite3.Connection, user_id: str, board_id: str) -> sqlite3.Row:
    """Returns the board row for its owner or a member; otherwise raises LookupError."""
    row = conn.execute(
        "SELECT boards.*, owner.username AS owner_username, owner.display_name AS owner_display "
        "FROM boards JOIN users AS owner ON owner.id = boards.user_id "
        "WHERE boards.id = ? AND (boards.user_id = ? OR EXISTS ("
        "  SELECT 1 FROM board_members WHERE board_id = boards.id AND user_id = ?))",
        (board_id, user_id, user_id),
    ).fetchone()
    if row is None:
        raise LookupError(BOARD_NOT_FOUND)
    return row


def _require_owner(conn: sqlite3.Connection, user_id: str, board_id: str) -> sqlite3.Row:
    row = _require_board(conn, user_id, board_id)
    if row["user_id"] != user_id:
        raise PermissionError(OWNER_ONLY)
    return row


def _summary(conn: sqlite3.Connection, row: sqlite3.Row, user_id: str) -> BoardSummaryModel:
    card_count = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE board_id = ?", (row["id"],)
    ).fetchone()[0]
    member_count = conn.execute(
        "SELECT COUNT(*) FROM board_members WHERE board_id = ?", (row["id"],)
    ).fetchone()[0]
    return BoardSummaryModel(
        id=row["id"],
        title=row["title"],
        description=row["description"],
        cardCount=card_count,
        createdAt=row["created_at"],
        updatedAt=row["updated_at"],
        isOwner=row["user_id"] == user_id,
        ownerName=row["owner_display"] or row["owner_username"],
        memberCount=member_count,
    )


def list_boards(user_id: str) -> list[BoardSummaryModel]:
    """Boards the user owns or was added to, oldest first."""
    with get_connection() as conn:
        ids = conn.execute(
            "SELECT id FROM boards WHERE user_id = ? OR id IN "
            "(SELECT board_id FROM board_members WHERE user_id = ?) ORDER BY created_at, id",
            (user_id, user_id),
        ).fetchall()
        return [_summary(conn, _require_board(conn, user_id, row["id"]), user_id) for row in ids]


def create_board_in(
    conn: sqlite3.Connection, user_id: str, title: str, description: str
) -> BoardSummaryModel:
    board_id = _new_id("board")
    now = get_now_iso()
    conn.execute(
        "INSERT INTO boards (id, user_id, title, description, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (board_id, user_id, title.strip(), description.strip(), now, now),
    )
    # Generated column ids: databases from before per-board keys only allow each id once.
    for order, column_title in enumerate(DEFAULT_COLUMN_TITLES):
        column_id = _new_id("col")
        conn.execute(
            "INSERT INTO board_columns (id, board_id, column_key, title, sort_order) VALUES (?, ?, ?, ?, ?)",
            (column_id, board_id, column_id, column_title, order),
        )
    activity.record(conn, board_id, _name_of(conn, user_id), ["created the board"])
    return _summary(conn, _require_board(conn, user_id, board_id), user_id)


def create_board(user_id: str, title: str, description: str) -> BoardSummaryModel:
    with get_connection() as conn:
        return create_board_in(conn, user_id, title, description)


def get_board_summary(user_id: str, board_id: str) -> BoardSummaryModel:
    with get_connection() as conn:
        return _summary(conn, _require_board(conn, user_id, board_id), user_id)


def update_board(
    user_id: str, board_id: str, title: str | None, description: str | None
) -> BoardSummaryModel:
    """Members may rename and describe a board; only deleting and sharing are owner-only."""
    with get_connection() as conn:
        row = _require_board(conn, user_id, board_id)
        new_title = title.strip() if title is not None else row["title"]
        new_description = description.strip() if description is not None else row["description"]
        conn.execute(
            "UPDATE boards SET title = ?, description = ?, updated_at = ? WHERE id = ?",
            (new_title, new_description, get_now_iso(), board_id),
        )
        messages = []
        if new_title != row["title"]:
            messages.append(f'renamed the board to "{new_title}"')
        if new_description != row["description"]:
            messages.append("updated the description")
        activity.record(conn, board_id, _name_of(conn, user_id), messages)
        return _summary(conn, _require_board(conn, user_id, board_id), user_id)


def _delete_board_rows(conn: sqlite3.Connection, board_id: str) -> None:
    # Children first: the foreign keys are enforced and there is no cascade.
    conn.execute("DELETE FROM cards WHERE board_id = ?", (board_id,))
    conn.execute("DELETE FROM board_columns WHERE board_id = ?", (board_id,))
    conn.execute("DELETE FROM board_members WHERE board_id = ?", (board_id,))
    conn.execute("DELETE FROM activity WHERE board_id = ?", (board_id,))
    conn.execute("DELETE FROM boards WHERE id = ?", (board_id,))


def delete_board(user_id: str, board_id: str) -> None:
    with get_connection() as conn:
        _require_owner(conn, user_id, board_id)
        _delete_board_rows(conn, board_id)


def delete_boards_of_user(conn: sqlite3.Connection, user_id: str) -> None:
    """Removes the boards a user owns and their memberships of other boards."""
    for row in conn.execute("SELECT id FROM boards WHERE user_id = ?", (user_id,)).fetchall():
        _delete_board_rows(conn, row["id"])
    for row in conn.execute(
        "SELECT board_id FROM board_members WHERE user_id = ?", (user_id,)
    ).fetchall():
        _unassign(conn, row["board_id"], user_id)
    conn.execute("DELETE FROM board_members WHERE user_id = ?", (user_id,))


# --- Members -----------------------------------------------------------------


def list_members(user_id: str, board_id: str) -> list[BoardMemberModel]:
    """The owner first, then members in the order they were added."""
    with get_connection() as conn:
        board = _require_board(conn, user_id, board_id)
        owner = conn.execute("SELECT * FROM users WHERE id = ?", (board["user_id"],)).fetchone()
        members = conn.execute(
            "SELECT users.* FROM board_members JOIN users ON users.id = board_members.user_id "
            "WHERE board_members.board_id = ? ORDER BY board_members.added_at, users.username",
            (board_id,),
        ).fetchall()

    def to_member(row: sqlite3.Row, role: str) -> BoardMemberModel:
        return BoardMemberModel(
            userId=row["id"], username=row["username"], displayName=row["display_name"], role=role
        )

    return [to_member(owner, "owner"), *(to_member(row, "member") for row in members)]


def add_member(user_id: str, board_id: str, username: str) -> list[BoardMemberModel]:
    with get_connection() as conn:
        board = _require_owner(conn, user_id, board_id)
        target = conn.execute(
            "SELECT id FROM users WHERE username = ? COLLATE NOCASE", (username.strip(),)
        ).fetchone()
        if target is None:
            raise LookupError(f'No user named "{username.strip()}".')
        if target["id"] == board["user_id"]:
            raise ConflictError("The owner already has access.")
        added = conn.execute(
            "INSERT OR IGNORE INTO board_members (board_id, user_id, added_at) VALUES (?, ?, ?)",
            (board_id, target["id"], get_now_iso()),
        ).rowcount
        if not added:
            raise ConflictError("That user is already a member.")
        activity.record(
            conn, board_id, _name_of(conn, user_id), [f"shared the board with {_name_of(conn, target['id'])}"]
        )
    return list_members(user_id, board_id)


def remove_member(user_id: str, board_id: str, member_id: str) -> None:
    """The owner can remove anyone else; a member can remove only themselves (leave)."""
    with get_connection() as conn:
        board = _require_board(conn, user_id, board_id)
        if member_id == board["user_id"]:
            raise ValueError("The owner cannot be removed from their own board.")
        if user_id != board["user_id"] and user_id != member_id:
            raise PermissionError(OWNER_ONLY)
        removed = conn.execute(
            "DELETE FROM board_members WHERE board_id = ? AND user_id = ?", (board_id, member_id)
        ).rowcount
        if not removed:
            raise LookupError("Member not found")
        _unassign(conn, board_id, member_id)
        message = (
            "left the board"
            if user_id == member_id
            else f"removed {_name_of(conn, member_id)} from the board"
        )
        activity.record(conn, board_id, _name_of(conn, user_id), [message])


def list_activity(user_id: str, board_id: str, limit: int = 50) -> list[ActivityModel]:
    """Newest first."""
    with get_connection() as conn:
        _require_board(conn, user_id, board_id)
        rows = conn.execute(
            "SELECT * FROM activity WHERE board_id = ? ORDER BY id DESC LIMIT ?", (board_id, limit)
        ).fetchall()
    return [
        ActivityModel(id=row["id"], actor=row["actor"], message=row["message"], createdAt=row["created_at"])
        for row in rows
    ]


# --- Board data --------------------------------------------------------------




def _read_data(conn: sqlite3.Connection, board_id: str) -> BoardDataModel:
    column_rows = conn.execute(
        "SELECT id, title FROM board_columns WHERE board_id = ? ORDER BY sort_order",
        (board_id,),
    ).fetchall()
    card_rows = conn.execute(
        "SELECT * FROM cards WHERE board_id = ? ORDER BY sort_order", (board_id,)
    ).fetchall()

    columns = {row["id"]: ColumnModel(id=row["id"], title=row["title"]) for row in column_rows}
    for row in card_rows:
        columns[row["column_id"]].cardIds.append(row["id"])

    return BoardDataModel(
        columns=list(columns.values()),
        cards={
            row["id"]: CardModel(
                id=row["id"],
                title=row["title"],
                details=row["details"],
                priority=row["priority"],
                dueDate=row["due_date"],
                labels=json.loads(row["labels"]),
                assigneeId=row["assignee_id"],
            )
            for row in card_rows
        },
    )


def read_board(user_id: str, board_id: str) -> tuple[BoardDataModel, int]:
    """The board's columns and cards with its current version, read together."""
    with get_connection() as conn:
        version = _require_board(conn, user_id, board_id)["version"]
        return _read_data(conn, board_id), version


def board_participants(user_id: str, board_id: str) -> dict[str, str]:
    """User id to display name for everyone who can be assigned cards on the board."""
    with get_connection() as conn:
        _require_board(conn, user_id, board_id)
        return _participants(conn, board_id)


def save_board_record(
    user_id: str,
    board_id: str,
    board: BoardDataModel,
    expected_version: int | None = None,
    via_ai: bool = False,
) -> int:
    """Replaces the board's columns and cards, logs what changed, and returns the new version.

    With expected_version, the save is refused (VersionConflictError) unless the board is
    still at that version, so a stale client cannot overwrite someone else's change.
    Cards may only be assigned to the board's owner or members (InvalidBoardError).
    """
    now = get_now_iso()
    with get_connection() as conn:
        _require_board(conn, user_id, board_id)
        participants = _participants(conn, board_id)
        strangers = sorted(
            {card.assigneeId for card in board.cards.values() if card.assigneeId} - set(participants)
        )
        if strangers:
            raise InvalidBoardError("Cards can only be assigned to people on the board.")

        # Check and bump in one statement, before anything else is written. That takes the
        # database write lock, so two saves based on the same version cannot both pass.
        bump = "UPDATE boards SET updated_at = ?, version = version + 1 WHERE id = ?"
        params: tuple = (now, board_id)
        if expected_version is not None:
            bump += " AND version = ?"
            params += (expected_version,)
        if not conn.execute(bump, params).rowcount:
            raise VersionConflictError(
                "This board was changed by someone else. Reload to see the latest version."
            )
        version = conn.execute("SELECT version FROM boards WHERE id = ?", (board_id,)).fetchone()[0]

        # Cards and columns are rewritten in full, so read what must survive first: the
        # delete below would otherwise reset every card's created_at on every save.
        previous = _read_data(conn, board_id)
        existing_created_at = {
            row["id"]: row["created_at"]
            for row in conn.execute(
                "SELECT id, created_at FROM cards WHERE board_id = ?", (board_id,)
            )
        }
        existing_keys = {
            row["id"]: row["column_key"]
            for row in conn.execute(
                "SELECT id, column_key FROM board_columns WHERE board_id = ?", (board_id,)
            )
        }

        conn.execute("DELETE FROM cards WHERE board_id = ?", (board_id,))
        conn.execute("DELETE FROM board_columns WHERE board_id = ?", (board_id,))
        for column_order, column in enumerate(board.columns):
            conn.execute(
                "INSERT INTO board_columns (id, board_id, column_key, title, sort_order) VALUES (?, ?, ?, ?, ?)",
                (column.id, board_id, existing_keys.get(column.id, column.id), column.title, column_order),
            )
            for card_order, card_id in enumerate(column.cardIds):
                card = board.cards[card_id]
                conn.execute(
                    "INSERT INTO cards (id, board_id, column_id, title, details, sort_order, created_at, "
                    "updated_at, priority, due_date, labels, assignee_id) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        card.id,
                        board_id,
                        column.id,
                        card.title,
                        card.details,
                        card_order,
                        existing_created_at.get(card_id, now),
                        now,
                        card.priority,
                        card.dueDate.isoformat() if card.dueDate else None,
                        json.dumps(card.labels),
                        card.assigneeId,
                    ),
                )

        actor = participants[user_id]
        if via_ai:
            actor = f"AI assistant (asked by {actor})"
        activity.record(conn, board_id, actor, activity.describe_changes(previous, board, participants))

    return version
