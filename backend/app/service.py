from fastapi import HTTPException

from app.database import get_connection, get_now_iso
from app.schemas import BoardDataModel, CardModel, ColumnModel

DEFAULT_BOARD_ID = "board-1"


def get_board_record() -> BoardDataModel:
    with get_connection() as conn:
        board_row = conn.execute(
            "SELECT * FROM boards WHERE id = ?",
            (DEFAULT_BOARD_ID,),
        ).fetchone()
        if board_row is None:
            raise HTTPException(status_code=404, detail="Board not found")

        columns = conn.execute(
            "SELECT * FROM board_columns WHERE board_id = ? ORDER BY sort_order ASC",
            (board_row["id"],),
        ).fetchall()
        card_rows = conn.execute(
            "SELECT * FROM cards WHERE board_id = ? ORDER BY sort_order ASC",
            (board_row["id"],),
        ).fetchall()

    column_map: dict[str, ColumnModel] = {}
    for column_row in columns:
        column_map[column_row["id"]] = ColumnModel(
            id=column_row["id"],
            title=column_row["title"],
            cardIds=[],
        )

    for card_row in card_rows:
        column_id = card_row["column_id"]
        if column_id in column_map:
            column_map[column_id].cardIds.append(card_row["id"])

    board_columns = [
        ColumnModel(id=column.id, title=column.title, cardIds=column.cardIds)
        for column in column_map.values()
    ]
    cards = {
        card_row["id"]: CardModel(
            id=card_row["id"],
            title=card_row["title"],
            details=card_row["details"],
        )
        for card_row in card_rows
    }

    return BoardDataModel(columns=board_columns, cards=cards)


def save_board_record(board: BoardDataModel) -> BoardDataModel:
    with get_connection() as conn:
        conn.execute("DELETE FROM cards WHERE board_id = ?", (DEFAULT_BOARD_ID,))
        conn.execute("DELETE FROM board_columns WHERE board_id = ?", (DEFAULT_BOARD_ID,))

        for index, column in enumerate(board.columns):
            column_id = column.id
            conn.execute(
                "INSERT INTO board_columns (id, board_id, column_key, title, sort_order) VALUES (?, ?, ?, ?, ?)",
                (column_id, DEFAULT_BOARD_ID, column_id, column.title, index),
            )

            for card_index, card_id in enumerate(column.cardIds):
                card = board.cards.get(card_id)
                if card is None:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Card '{card_id}' is referenced by '{column_id}' but missing from the payload.",
                    )
                conn.execute(
                    "INSERT INTO cards (id, board_id, column_id, title, details, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        card.id,
                        DEFAULT_BOARD_ID,
                        column_id,
                        card.title,
                        card.details,
                        card_index,
                        get_now_iso(),
                        get_now_iso(),
                    ),
                )

        conn.execute(
            "UPDATE boards SET updated_at = ? WHERE id = ?",
            (get_now_iso(), DEFAULT_BOARD_ID),
        )
        conn.commit()

    return board
