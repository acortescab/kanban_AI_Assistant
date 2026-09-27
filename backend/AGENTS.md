# Backend agent notes

FastAPI app that serves the API, persists the board in SQLite, calls OpenRouter for the AI chat, and serves the static frontend build.

## Structure

- `app/main.py`: routes (`/api/health`, `GET`/`PUT /api/board`, `/api/ai/test`, `/api/ai/chat`), the lifespan that runs `init_database()`, and the static site mounted at `/` (from `app/static` in Docker or `../frontend/out` locally).
- `app/schemas.py`: Pydantic models. `BoardDataModel` enforces the five fixed column ids in order, and that every card is referenced exactly once.
- `app/database.py`: SQLite path from `KANBAN_DB_PATH`, the `get_connection()` context manager (commits and closes, and turns on `PRAGMA foreign_keys`), and the schema. Seeds the sample board only when the board row is first created. Column and card ids are unique per board (composite primary keys).
- `app/service.py`: reads and writes the single MVP board (`board-1`). Saves update column titles and replace the cards, carrying each card's original `created_at` across. A missing board raises `LookupError`, which the route turns into a 404.
- `app/ai_flow.py`: builds the prompt from the saved board and recent history, requests structured output, then validates and saves any board the AI returns. The AI may not drop existing cards.
- `app/openrouter_client.py`: OpenRouter call. Loads the root `.env` with python-dotenv. `OPENROUTER_URL` overrides the endpoint. Timeouts are 120s because a 27B model on the free pool is slow; a 429 becomes a "rate limited" message.

## Commands (from backend/)

```bash
uv run pytest
uv run pytest -m live   # opt-in: calls the real OpenRouter model, skips when rate limited
uv run uvicorn app.main:app --reload --port 8000
uv lock   # after changing dependencies
```

Tests get a fresh temporary database per test (`tests/conftest.py`) and never call OpenRouter.
