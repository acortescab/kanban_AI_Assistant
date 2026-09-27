from collections import Counter
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FIXED_COLUMN_IDS = ["col-backlog", "col-discovery", "col-progress", "col-review", "col-done"]

# Caps that keep a single request inside a normal model context. Long enough for real use,
# short enough that a runaway or hostile payload cannot blow up the prompt.
MAX_TITLE_LENGTH = 200
MAX_DETAILS_LENGTH = 5000
MAX_COLUMN_TITLE_LENGTH = 100
MAX_QUESTION_LENGTH = 4000
MAX_MESSAGE_LENGTH = 4000
MAX_HISTORY_MESSAGES = 40


class CardModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    details: str = Field(default="", max_length=MAX_DETAILS_LENGTH)


class ColumnModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    title: str = Field(min_length=1, max_length=MAX_COLUMN_TITLE_LENGTH)
    cardIds: list[str] = Field(default_factory=list)


class BoardDataModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[ColumnModel]
    cards: dict[str, CardModel]

    @model_validator(mode="after")
    def validate_board_data(self):
        column_ids = [column.id for column in self.columns]
        if column_ids != FIXED_COLUMN_IDS:
            raise ValueError(f"Columns must be exactly {FIXED_COLUMN_IDS} in that order.")

        referenced_ids = [card_id for column in self.columns for card_id in column.cardIds]
        duplicate_card_ids = sorted(
            card_id for card_id, count in Counter(referenced_ids).items() if count > 1
        )
        if duplicate_card_ids:
            raise ValueError(f"Duplicate card references are not allowed: {duplicate_card_ids}")

        missing_card_ids = sorted(set(referenced_ids) - set(self.cards))
        if missing_card_ids:
            raise ValueError(f"Missing card definitions for ids: {missing_card_ids}")

        orphan_card_ids = sorted(set(self.cards) - set(referenced_ids))
        if orphan_card_ids:
            raise ValueError(f"Cards must be assigned to a column: {orphan_card_ids}")

        return self


class ChatMessageModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)


class AIChatRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=MAX_QUESTION_LENGTH)
    history: list[ChatMessageModel] = Field(
        default_factory=list, max_length=MAX_HISTORY_MESSAGES
    )


class AIChatResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    response: str
    board: BoardDataModel | None = None
