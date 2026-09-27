# Backend agent notes

FastAPI app that serves the API, persists users and boards in SQLite, calls OpenRouter for the AI chat, and serves the static frontend build.

## Structure

- `app/main.py`: routes, the `require_user` / `require_admin` dependencies (session cookie `kanban_session`), the lifespan that runs `init_database()`, and the static site mounted at `/` (from `app/static` in Docker or `../frontend/out` locally).
  - Account: `POST /api/auth/register|login|logout`, `GET|PATCH|DELETE /api/auth/me`, `POST /api/auth/password`.
  - Boards: `GET|POST /api/boards`, `GET|PATCH|DELETE /api/boards/{id}`, `GET|PUT /api/boards/{id}/data` (version in `ETag`, optional `If-Match` on PUT, 409 when stale), `POST /api/boards/{id}/ai/chat` (409 if the board changed during the model call).
  - Activity: `GET /api/boards/{id}/activity` (newest 50).
  - Sharing: `GET|POST /api/boards/{id}/members`, `DELETE /api/boards/{id}/members/{userId}` (owner removes anyone else; a member removes only themselves).
  - Admin: `GET /api/admin/users`, `PATCH|DELETE /api/admin/users/{id}`. Admins cannot change or delete themselves there; the only admin cannot delete their own account.
- `app/schemas.py`: Pydantic models. `BoardDataModel` requires 1 to 12 columns with unique ids and every card referenced exactly once, keyed by its own id. Cards have priority, an optional due date and up to 10 labels.
- `app/security.py`: scrypt password hashing (parameters stored in each hash) and session tokens.
- `app/database.py`: SQLite path from `KANBAN_DB_PATH`, `get_connection()` (commits, closes, turns on `PRAGMA foreign_keys`), the schema, and migration of older databases by adding missing columns. The demo admin (`user` / `password`) and its sample `board-1` are created only when the demo user is first created, so a deleted demo board stays deleted.
- `app/service.py`: boards, visible to their owner and members. A missing board or one the caller cannot see raises `LookupError` (404); an owner-only action by a member raises `PermissionError` (403). `save_board_record` checks and bumps the version in a single conditional `UPDATE` before rewriting, raising `VersionConflictError` when stale. Saves replace columns and cards, keeping each card's `created_at` and each column's `column_key`. New boards get generated column ids, because MVP databases have single-column primary keys.
- `app/activity.py`: `describe_changes` (a pure diff of two boards into readable messages) and `record` (inserts and prunes to 200 per board). Actors are stored by name so history survives deleted accounts.
- `app/users.py`: accounts, sessions (30 days), password change (signs out other sessions), deletion (removes the user's boards and sessions), admin listing and roles.
- `app/ai_flow.py`: builds the prompt from the saved board and recent history, requests structured output, then validates and saves any board the AI returns. The AI may not drop existing cards.
- `app/openrouter_client.py`: OpenRouter call. Loads the root `.env` with python-dotenv. `OPENROUTER_URL` overrides the endpoint. Timeouts are 120s because a 27B model on the free pool is slow; a 429 becomes a "rate limited" message.

## Commands (from backend/)

```bash
uv run pytest
uv run pytest --cov=app --cov-report=term-missing
uv run pytest -m live   # opt-in: calls the real OpenRouter model, skips when rate limited
uv run uvicorn app.main:app --reload --port 8000
uv lock   # after changing dependencies
```

Tests get a fresh temporary database per test and cheap scrypt parameters (`tests/conftest.py`), and never call OpenRouter. Fixtures: `client` (no session), `demo` (the seeded admin, owns `board-1`), `alice` (a registered regular user).
