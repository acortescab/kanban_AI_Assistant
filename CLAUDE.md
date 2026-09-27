# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `AGENTS.md` (requirements, color scheme, coding standards) and `docs/PLAN.md` (phased plan and current implementation decisions) before making changes. Coding standards there are binding: keep it simple, no over-engineering, no emojis, prove root cause before fixing.

## Commands

Full stack (Docker, serves everything at http://localhost:8000):

```bash
scripts/start.sh      # or start.ps1 / start.bat; `docker compose up --build -d`, then waits for /api/health
scripts/stop.sh       # or stop.ps1 / stop.bat; `docker compose down` (keeps the kanban-data volume)
```

Backend (run from `backend/`; uv manages `backend/.venv` from `pyproject.toml` + `uv.lock`, dev deps in `[dependency-groups]`):

```bash
uv run pytest                                   # all tests
uv run pytest --cov=app --cov-report=term-missing
uv run pytest tests/test_ai_flow.py::test_name  # single test
uv run uvicorn app.main:app --reload --port 8000
uv lock                                         # after changing dependencies; commit uv.lock
```

Frontend (run from `frontend/`):

```bash
npm run dev                            # Next dev server on :3000
npm run build                          # static export to frontend/out
npm run lint                           # ESLint (must be clean)
npm run typecheck                      # tsc --noEmit, includes test files (must be clean)
npm run test:unit                      # Vitest
npm run test:coverage                  # Vitest with coverage
npx vitest run src/lib/kanban.test.ts  # single file (add -t "name" for one test)
npm run test:e2e                       # Playwright; builds, serves via `uv run` uvicorn on :8001 with a fresh temp DB,
                                       # and points the backend at tests/openrouter-stub.mjs (:8011) instead of OpenRouter
```

## Architecture

- **Single container.** `.dockerignore` keeps local `node_modules`, `.venv`, builds and `*.db` out of the build context. The Python stage uses a pinned uv image and `uv sync --frozen --no-dev`. The Dockerfile builds the Next.js app as a static export (`output: "export"` in `next.config.ts`), copies `frontend/out` into `backend/app/static`, and runs uvicorn. `main.py` mounts the whole export with `StaticFiles(html=True)` at `/`, after the API routes so they take precedence. Outside Docker it falls back to `frontend/out` if it exists.
- **Frontend talks to the backend via same-origin relative `/api/*` URLs** through `src/lib/api.ts`. There is no Next API route or dev proxy, so the `npm run dev` server alone has no working backend; unit tests use the in-memory backend in `src/test/fakeServer.ts`.
- **Accounts and sessions** (`backend/app/users.py`, `security.py`): users register and sign in; passwords are scrypt-hashed; a session is a random token in the `sessions` table sent as the HttpOnly `kanban_session` cookie (30 days). Every board, AI and admin route requires a session and only sees boards the caller owns or is a member of (others are 404). Owners share a board by username (`board_members` table); members can edit content, rename and use the AI, and can leave; only the owner can share, remove members or delete the board (403 otherwise). Roles are `user` and `admin`. The seeded demo account `user` / `password` is an admin and owns the sample `board-1`.
- **Board contract** (shared by frontend `src/lib/kanban.ts` and backend `app/schemas.py`): `{ columns: [{id, title, cardIds}], cards: { [id]: {id, title, details, priority, dueDate, labels, assigneeId} } }`. `assigneeId` must be the board's owner or a member (422 otherwise); removing a member clears their assignments and bumps the version. Column order and card order come from array position. Boards have 1 to 12 columns with unique ids; board metadata (title, description, counts) is a separate `BoardSummary` from `/api/boards`.
- **Persistence** (`backend/app/database.py`, `service.py`): SQLite at `KANBAN_DB_PATH` (default `backend/app/kanban.db`, untracked; in Docker `/app/data/kanban.db` on the `kanban-data` volume). `init_database()` runs in the FastAPI lifespan, adds columns missing from older databases, and seeds the demo user plus `board-1` only when the demo user is first created. Tables: users, sessions, boards, board_columns, cards. Column and card ids are unique per board (composite primary keys); MVP databases keep single-column keys, so new boards get generated column ids. `get_connection()` is a context manager that commits and closes. `PUT /api/boards/{id}/data` replaces the board's columns and cards. Backend tests get a fresh temp DB per test via the autouse fixture in `backend/tests/conftest.py`.
- **Frontend views**: `page.tsx` checks the session, then renders `AuthScreen` or `Workspace` (header with board switcher; views: one board, boards overview, account settings, admin users). A 401 anywhere fires `UNAUTHORIZED_EVENT` and returns to sign in.
- **Activity** (`backend/app/activity.py`): every board save diffs old against new (`describe_changes`) and records readable entries (added / moved / updated / assigned / deleted cards, column changes), plus board renames and membership changes. AI saves are attributed to "AI assistant (asked by X)". Capped at 200 entries per board; `GET /api/boards/{id}/activity` returns the newest 50.
- **Versioned saves** (optimistic concurrency): each board has a `version`. `GET`/`PUT /data` and the AI route return it as `ETag: "<n>"`; a `PUT` with a stale `If-Match` gets 409 and changes nothing (no `If-Match` means unconditional). The check-and-bump is one conditional `UPDATE`, so concurrent saves cannot both win. The AI saves against the version it read, so an edit made while the model was thinking is kept and the AI reply is refused with 409.
- **Frontend saves**: `KanbanBoard` renders nothing editable until the GET succeeds (no local fallback). Every change goes through `updateBoard`, which queues PUTs so they are sent one at a time with `If-Match` set to the last known version. Any failure reloads the stored board (a 409 says someone else changed it) and drops saves queued behind it (`generation` ref). An AI edit is applied directly with the version the server returned; the page does not save it again. Drag-and-drop persists on drop only; `onDragOver` just highlights the target column. Card search / filters (`CardFilterBar`, `matchesFilter`) only hide cards; saves always send the full board.
- **AI flow** (`backend/app/ai_flow.py`, `openrouter_client.py`): `POST /api/boards/{id}/ai/chat` receives `{question, history}` (a client-sent board is rejected). The backend reads the saved board itself, sends a system prompt with the board JSON plus the last `MAX_HISTORY_MESSAGES` of history to OpenRouter (`qwen/qwen3.8-27b:free`) with `response_format` set to the `AIChatResponseModel` JSON schema, and expects `{response, board|null}`. The parser still tolerates code fences and surrounding text. A non-null board is validated as a full replacement and saved; any malformed board rejects the whole response (502). Missing key / rate limit surface as 503. `AiChatSidebar` gets `waitForSaves` (awaits `KanbanBoard`'s save queue before the request, so the AI sees the latest edit) and `onBoardUpdate` (applies the returned board directly, no refetch). `POST /api/ai/test` is a plain connectivity check.
- **E2E tests** share one database per run, so demo-board tests in `tests/kanban.spec.ts` work on different cards and account/board tests register their own unique user. Every mutation test reloads the page (the session cookie survives) to prove the change was persisted. Avoid `getByRole("button", { name })` at page level: dnd-kit gives each card `role="button"` with its whole text as the name. Scope to the card's test id instead.
- **Config.** `OPENROUTER_URL` overrides the OpenRouter endpoint (used by the e2e stub). `OPENROUTER_API_KEY` comes from the root `.env`: loaded once at import by python-dotenv for local runs (existing env vars win), and via `env_file` in docker-compose.
- **Styling.** Tailwind v4 with CSS variables in `src/app/globals.css` mapped to the AGENTS.md color scheme. No external fonts (Google Fonts break Docker builds).
