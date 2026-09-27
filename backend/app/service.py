from fastapi import HTTPException

from app.database import get_connection, get_now_iso
from app.schemas import BoardDataModel, CardModel, ColumnModel

DEFAULT_BOARD_ID = "board-1"


def get_board_record() -> BoardDataModel:
    with get_connection() as conn:
        board_row = conn.execute(
            "SELECT id FROM boards WHERE id = ?",
            (DEFAULT_BOARD_ID,),
        ).fetchone()
        if board_row is None:
            raise HTTPException(status_code=404, detail="Board not found")

        column_rows = conn.execute(
            "SELECT id, title FROM board_columns WHERE board_id = ? ORDER BY sort_order",
            (DEFAULT_BOARD_ID,),
        ).fetchall()
        card_rows = conn.execute(
            "SELECT id, column_id, title, details FROM cards WHERE board_id = ? ORDER BY sort_order",
            (DEFAULT_BOARD_ID,),
        ).fetchall()

    columns = {row["id"]: ColumnModel(id=row["id"], title=row["title"]) for row in column_rows}
    for row in card_rows:
        columns[row["column_id"]].cardIds.append(row["id"])

    return BoardDataModel(
        columns=list(columns.values()),
        cards={
            row["id"]: CardModel(id=row["id"], title=row["title"], details=row["details"])
            for row in card_rows
        },
    )


def save_board_record(board: BoardDataModel) -> BoardDataModel:
    # Columns are fixed (enforced by BoardDataModel), so only their titles change.
    now = get_now_iso()
    with get_connection() as conn:
        for column in board.columns:
            conn.execute(
                "UPDATE board_columns SET title = ? WHERE board_id = ? AND id = ?",
                (column.title, DEFAULT_BOARD_ID, column.id),
            )

        conn.execute("DELETE FROM cards WHERE board_id = ?", (DEFAULT_BOARD_ID,))
        for column in board.columns:
            for card_order, card_id in enumerate(column.cardIds):
                card = board.cards[card_id]
                conn.execute(
                    "INSERT INTO cards (id, board_id, column_id, title, details, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (card.id, DEFAULT_BOARD_ID, column.id, card.title, card.details, card_order, now, now),
                )

        conn.execute(
            "UPDATE boards SET updated_at = ? WHERE id = ?",
            (now, DEFAULT_BOARD_ID),
        )

    return board
