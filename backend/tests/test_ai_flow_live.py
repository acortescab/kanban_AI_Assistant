"""End-to-end check of the AI flow against the real OpenRouter API.

These are the only tests that exercise the model, the structured-output parameter
and the parser together. They are skipped without OPENROUTER_API_KEY.

Run them with:

    uv run pytest -m live

The free model sits behind a shared upstream provider pool and is frequently
rate limited, so a 429 here is a provider condition, not a code failure.
"""

import pytest

from app.ai_flow import (
    RESPONSE_FORMAT,
    build_structured_ai_messages,
    generate_structured_ai_response,
    parse_structured_ai_response,
    reject_removed_cards,
)
from app.openrouter_client import call_openrouter, call_openrouter_messages, get_openrouter_api_key
from app.schemas import AIChatRequestModel, ChatMessageModel
from app.database import DEMO_BOARD_ID, DEMO_USER_ID
from app.service import read_board

pytestmark = pytest.mark.live


def demo_board():
    return read_board(DEMO_USER_ID, DEMO_BOARD_ID)[0]


@pytest.fixture(autouse=True)
def require_api_key():
    try:
        get_openrouter_api_key()
    except RuntimeError as exc:
        pytest.skip(str(exc))


def call(*args, **kwargs):
    """Turns an upstream rate limit into a skip, so only real defects fail."""
    try:
        return call_openrouter(*args, **kwargs)
    except RuntimeError as exc:
        if "rate limited" in str(exc):
            pytest.skip(f"OpenRouter free pool is busy: {exc}")
        raise


def call_structured(*args, **kwargs):
    try:
        return call_openrouter_messages(*args, **kwargs)
    except RuntimeError as exc:
        if "rate limited" in str(exc):
            pytest.skip(f"OpenRouter free pool is busy: {exc}")
        raise


def test_model_answers_a_simple_prompt():
    assert call("Reply with only the number: 2 + 2").strip().endswith("4")


def test_model_returns_a_parsable_board_when_asked_to_move_a_card():
    board = demo_board()
    request = AIChatRequestModel(
        question="Move the card titled 'Prototype analytics view' to the Done column.",
        history=[ChatMessageModel(role="assistant", content="I can help with that.")],
    )
    messages = build_structured_ai_messages(request, board)

    content = call_structured(messages, response_format=RESPONSE_FORMAT)
    parsed = parse_structured_ai_response(content)

    assert parsed.response.strip()
    if parsed.board is not None:
        reject_removed_cards(parsed.board, board)
        assert "Prototype analytics view" in {
            card.title for card in parsed.board.cards.values()
        }


def test_chat_route_applies_a_board_change_end_to_end():
    before = demo_board()
    request = AIChatRequestModel(question="Add a new card titled 'Live check' to Backlog.")

    try:
        response, _version = generate_structured_ai_response(request, DEMO_USER_ID, DEMO_BOARD_ID)
    except RuntimeError as exc:
        if "rate limited" in str(exc):
            pytest.skip(f"OpenRouter free pool is busy: {exc}")
        raise

    assert response.response.strip()
    if response.board is not None:
        after = demo_board()
        assert "Live check" in {card.title for card in after.cards.values()}
        assert len(after.cards) >= len(before.cards)
