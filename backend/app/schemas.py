from collections import Counter
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Caps that keep a single request inside a normal model context. Long enough for real use,
# short enough that a runaway or hostile payload cannot blow up the prompt.
MAX_TITLE_LENGTH = 200
MAX_DETAILS_LENGTH = 5000
MAX_COLUMN_TITLE_LENGTH = 100
MAX_COLUMNS = 12
MAX_LABELS = 10
MAX_LABEL_LENGTH = 30
MAX_BOARD_TITLE_LENGTH = 100
MAX_BOARD_DESCRIPTION_LENGTH = 500
MAX_QUESTION_LENGTH = 4000
MAX_MESSAGE_LENGTH = 4000
MAX_HISTORY_MESSAGES = 40

Priority = Literal["low", "medium", "high"]
Role = Literal["user", "admin"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CardModel(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    details: str = Field(default="", max_length=MAX_DETAILS_LENGTH)
    priority: Priority = "medium"
    dueDate: date | None = None
    labels: list[str] = Field(default_factory=list, max_length=MAX_LABELS)
    # A user id; the service checks it belongs to the board's owner or a member.
    assigneeId: str | None = None

    @model_validator(mode="after")
    def validate_labels(self):
        cleaned = [label.strip() for label in self.labels]
        if any(not label or len(label) > MAX_LABEL_LENGTH for label in cleaned):
            raise ValueError(f"Labels must be 1 to {MAX_LABEL_LENGTH} characters.")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("Labels must be unique.")
        self.labels = cleaned
        return self


class ColumnModel(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=MAX_COLUMN_TITLE_LENGTH)
    cardIds: list[str] = Field(default_factory=list)


class BoardDataModel(StrictModel):
    columns: list[ColumnModel] = Field(min_length=1, max_length=MAX_COLUMNS)
    cards: dict[str, CardModel]

    @model_validator(mode="after")
    def validate_board_data(self):
        column_ids = [column.id for column in self.columns]
        if len(set(column_ids)) != len(column_ids):
            raise ValueError("Column ids must be unique.")

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

        mismatched = sorted(card_id for card_id, card in self.cards.items() if card.id != card_id)
        if mismatched:
            raise ValueError(f"Card keys must match card ids: {mismatched}")

        return self


class BoardSummaryModel(StrictModel):
    id: str
    title: str
    description: str
    cardCount: int
    createdAt: str
    updatedAt: str
    isOwner: bool
    ownerName: str
    memberCount: int


class BoardMemberModel(StrictModel):
    userId: str
    username: str
    displayName: str
    role: Literal["owner", "member"]


class ActivityModel(StrictModel):
    id: int
    actor: str
    message: str
    createdAt: str


class MemberAddModel(StrictModel):
    username: str = Field(min_length=1, max_length=32)


class BoardCreateModel(StrictModel):
    title: str = Field(min_length=1, max_length=MAX_BOARD_TITLE_LENGTH)
    description: str = Field(default="", max_length=MAX_BOARD_DESCRIPTION_LENGTH)


class BoardUpdateModel(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=MAX_BOARD_TITLE_LENGTH)
    description: str | None = Field(default=None, max_length=MAX_BOARD_DESCRIPTION_LENGTH)


class UserModel(StrictModel):
    id: str
    username: str
    displayName: str
    role: Role
    createdAt: str


class AdminUserModel(UserModel):
    boardCount: int


class RegisterModel(StrictModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    displayName: str = Field(default="", max_length=60)


class LoginModel(StrictModel):
    username: str = Field(min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class ProfileUpdateModel(StrictModel):
    displayName: str = Field(max_length=60)


class PasswordChangeModel(StrictModel):
    currentPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


class AccountDeleteModel(StrictModel):
    password: str = Field(min_length=1, max_length=128)


class RoleUpdateModel(StrictModel):
    role: Role


class ChatMessageModel(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_LENGTH)


class AIChatRequestModel(StrictModel):
    question: str = Field(min_length=1, max_length=MAX_QUESTION_LENGTH)
    history: list[ChatMessageModel] = Field(
        default_factory=list, max_length=MAX_HISTORY_MESSAGES
    )


class AIChatResponseModel(StrictModel):
    response: str
    board: BoardDataModel | None = None
