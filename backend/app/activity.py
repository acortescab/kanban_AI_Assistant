import sqlite3

from app.database import get_now_iso
from app.schemas import BoardDataModel, CardModel

# Per board; older entries are pruned on write so the table cannot grow without bound.
MAX_ACTIVITY_PER_BOARD = 200

FIELD_NAMES = {
    "title": "title",
    "details": "details",
    "priority": "priority",
    "dueDate": "due date",
    "labels": "labels",
}


def _column_of(board: BoardDataModel) -> dict[str, str]:
    return {card_id: column.id for column in board.columns for card_id in column.cardIds}


def _assignment(card: CardModel, names: dict[str, str]) -> str:
    if card.assigneeId is None:
        return f'unassigned "{card.title}"'
    return f'assigned "{card.title}" to {names.get(card.assigneeId, "a former member")}'


def describe_changes(
    old: BoardDataModel, new: BoardDataModel, names: dict[str, str]
) -> list[str]:
    """Human-readable changes between two versions of a board. Reordering inside a column
    is left out: it is frequent and says little."""
    messages: list[str] = []
    old_titles = {column.id: column.title for column in old.columns}
    new_titles = {column.id: column.title for column in new.columns}

    for column in new.columns:
        if column.id not in old_titles:
            messages.append(f'added the column "{column.title}"')
        elif old_titles[column.id] != column.title:
            messages.append(f'renamed the column "{old_titles[column.id]}" to "{column.title}"')
    for column in old.columns:
        if column.id not in new_titles:
            messages.append(f'removed the column "{column.title}"')
    kept_old = [column.id for column in old.columns if column.id in new_titles]
    kept_new = [column.id for column in new.columns if column.id in old_titles]
    if kept_old != kept_new:
        messages.append("reordered the columns")

    old_columns, new_columns = _column_of(old), _column_of(new)
    for card_id, card in new.cards.items():
        before = old.cards.get(card_id)
        if before is None:
            messages.append(f'added "{card.title}" to {new_titles[new_columns[card_id]]}')
            if card.assigneeId is not None:
                messages.append(_assignment(card, names))
            continue
        if old_columns[card_id] != new_columns[card_id]:
            messages.append(
                f'moved "{card.title}" from {old_titles[old_columns[card_id]]} '
                f"to {new_titles[new_columns[card_id]]}"
            )
        changed = [
            label for field, label in FIELD_NAMES.items() if getattr(before, field) != getattr(card, field)
        ]
        if changed:
            messages.append(f'updated "{card.title}": {", ".join(changed)}')
        if before.assigneeId != card.assigneeId:
            messages.append(_assignment(card, names))
    for card_id, card in old.cards.items():
        if card_id not in new.cards:
            messages.append(f'deleted "{card.title}"')

    return messages


def record(conn: sqlite3.Connection, board_id: str, actor: str, messages: list[str]) -> None:
    now = get_now_iso()
    conn.executemany(
        "INSERT INTO activity (board_id, actor, message, created_at) VALUES (?, ?, ?, ?)",
        [(board_id, actor, message, now) for message in messages],
    )
    conn.execute(
        "DELETE FROM activity WHERE board_id = ? AND id NOT IN "
        "(SELECT id FROM activity WHERE board_id = ? ORDER BY id DESC LIMIT ?)",
        (board_id, board_id, MAX_ACTIVITY_PER_BOARD),
    )
