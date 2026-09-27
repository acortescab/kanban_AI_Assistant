from pydantic import BaseModel, Field, model_validator


class CardModel(BaseModel):
    id: str
    title: str
    details: str = ""


class ColumnModel(BaseModel):
    id: str
    title: str
    cardIds: list[str] = Field(default_factory=list)


class BoardDataModel(BaseModel):
    columns: list[ColumnModel]
    cards: dict[str, CardModel]

    @model_validator(mode="after")
    def validate_board_data(self):
        referenced_ids = {card_id for column in self.columns for card_id in column.cardIds}
        missing_card_ids = sorted(referenced_ids - set(self.cards))
        if missing_card_ids:
            raise ValueError(f"Missing card definitions for ids: {missing_card_ids}")
        return self
