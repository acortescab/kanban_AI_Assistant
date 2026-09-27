# Code Review

Date: 2026-09-27
Scope: entire repository at commit `9125023` (backend, frontend, Docker, scripts, tests, docs).

## Current health

| Check | Result |
|---|---|
| Backend `pytest` | 11 passed, 1 warning (Starlette: `httpx` with `TestClient` is deprecated) |
| Frontend `vitest run` | 13 passed |
| Frontend `eslint .` | 1 error, 1 warning |
| Frontend `tsc --noEmit` | Fails: test globals untyped, one type error in the Playwright spec |
| Business requirement "cards can be edited" | Not implemented |

Running the backend tests modifies the committed `backend/app/kanban.db` (see B3).

## Summary

The architecture is simple and fits the MVP. The main risks are to data integrity:

- Board data is lost whenever the container is recreated.
- A failed load followed by any edit overwrites the saved board with demo data.
- Drag-and-drop sends one save request per hover step.
- Nothing stops a save (including one from the AI) from changing the fixed columns, and a changed column set causes all cards to be deleted on the next startup.

Card editing, a stated requirement, is missing. Lint and typecheck fail. There is also a moderate amount of duplicated and dead defensive code that goes against the project's coding standards.

Severity: **High** = data loss or a missing requirement. **Medium** = incorrect behavior or a broken toolchain. **Low** = cleanup or simplification.

---

## High

### H1. Board data is not persisted across container restarts
- `docker-compose.yml` has no volume, so the SQLite file lives inside the container at `/app/backend/app/kanban.db`.
- `scripts/stop.*` runs `docker compose down`, which removes the container, and `scripts/start.sh:12-15` does the same before every start.
- Every stop/start cycle therefore resets the board to the seed data. This defeats the persistence built in PLAN Parts 6-7.
- **Action:**
  - Move the database path to a dedicated directory, e.g. `DB_PATH = Path(os.getenv("DB_PATH", ...))` or a fixed `/app/data/kanban.db`.
  - Mount a named volume there in `docker-compose.yml`.

### H2. A failed board load followed by any edit overwrites the saved board with demo data
- `KanbanBoard.tsx:52` initializes state to `initialData`.
- `KanbanBoard.tsx:67-69` silently falls back to `initialData` when the GET fails.
- The next user action goes through `updateBoard` (`KanbanBoard.tsx:97-110`) and PUTs that demo-derived board, replacing whatever was stored.
- The same happens if the user edits before the initial GET resolves.
- **Action:**
  - Start with `board = null` and render a loading state until the GET succeeds.
  - On failure, show an error and do not allow edits.
  - Remove the `initialData` fallback. `initialData` then only needs to exist as backend seed data and test fixture.

### H3. Card editing is not implemented
- AGENTS.md: "The cards on the Kanban board can be moved with drag and drop, and edited".
- `KanbanCard.tsx` only supports Remove. Only the AI can change a card's title or details.
- **Action:** add inline edit (title and details) to `KanbanCard`, wired through a `handleEditCard` in `KanbanBoard`, plus a unit test and an e2e test.

### H4. The fixed five-column board is not enforced; a different column set deletes all cards on restart
- `BoardDataModel` (`schemas.py:23-46`) accepts any list of columns. `PUT /api/board` and AI responses (`ai_flow.py:83-84`) can add, remove or re-id columns.
- `init_database()` (`database.py:93-102`) then sees unexpected column ids on the next startup and deletes all cards and columns.
- The AI does full board replacement and is only shown an example board, not the rules (`ai_flow.py:10-17`), so this is a realistic path.
- The backend test `test_board_route_persists_updates` does exactly this (see B3).
- **Action:**
  - Validate in `BoardDataModel` that column ids are exactly `col-backlog, col-discovery, col-progress, col-review, col-done`, in order.
  - Then remove the reset branch from `init_database()`.
  - Add the rules to the system prompt: fixed column ids, only titles renamable, and every card referenced exactly once.

### H5. Drag-over saves on every hover step, and saves race
- `handleDragOver` (`KanbanBoard.tsx:128-143`) calls `applyMove`, which PUTs the full board on each hover change, often dozens of requests per drag.
- The requests run concurrently in FastAPI's threadpool, so completion order is not guaranteed and a stale board can be written last.
- Errors are swallowed (`.catch(() => undefined)`, line 106), so the user is never told a save failed.
- `saveBoard` is called inside a `setBoard` updater (lines 98-109). Updaters must be pure, and React runs them twice in Strict Mode, which doubles the PUTs in dev.
- **Action:**
  - Keep `onDragOver` for visual state only and persist once in `onDragEnd`.
  - Move the save out of the state updater: compute `next`, `setBoard(next)`, then `saveBoard(next)`.
  - Show a visible error when a save fails.

---

## Medium

### M1. The AI may overwrite the user's latest edit
- `AiChatSidebar.tsx:94` re-fetches the board from the server rather than using the board on screen. If a PUT is still in flight, the AI works from a stale board.
- Its full-board reply is then saved and overwrites the user's change.
- **Action:** pass the current board from `KanbanBoard` as a prop and send that. Better still, have the backend read the persisted board itself in `/api/ai/chat` and drop `board` from the request (simpler contract, no stale-client risk).

### M2. Lint error in `KanbanColumn`
- `KanbanColumn.tsx:30-32` calls `setDraftTitle` inside an effect (`react-hooks/set-state-in-effect`).
- **Action:** remove the effect and give the column a `key` that includes the title from the parent (`key={`${column.id}:${column.title}`}`), or make the input uncontrolled with `defaultValue`.
- Also fix the unused `init` parameter in `AiChatSidebar.test.tsx:27`.

### M3. TypeScript check fails
- `src/test/vitest.d.ts:1` references `vitest` instead of `vitest/globals`, so `describe`/`it`/`expect` are untyped (47 errors).
- `tests/kanban.spec.ts:3` uses `Parameters<typeof test>[0]["page"]`. The first parameter of `test` is the title string.
- **Action:**
  - Change the reference to `/// <reference types="vitest/globals" />`.
  - Type the helper parameter as `Page` from `@playwright/test`.
  - Add a `typecheck` script (`tsc --noEmit`).

### M4. The Docker build copies local artifacts and the dev database
- There is no `.dockerignore`. `COPY frontend .` (`Dockerfile:5`) copies host `node_modules` (Windows binaries), `.next` and `out` over the clean `npm ci` install.
- `COPY backend/app ./app` (`Dockerfile:21`) bakes the local `kanban.db` into the image.
- **Action:** add a `.dockerignore` excluding `**/node_modules`, `**/.next`, `frontend/out`, `**/kanban.db`, `.venv`, `.env`, `**/__pycache__`, `frontend/test-results`.

### M5. uv is used unidiomatically and without a lockfile
- `Dockerfile:17,24` installs uv via pip and then runs `uv pip install .` with open-ended version ranges. There is no `uv.lock`, so builds are not reproducible.
- **Action:**
  - Commit `backend/uv.lock`.
  - Use `COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/` with `uv sync --frozen --no-dev`.
  - Declare dev dependencies under `[dependency-groups]` so local runs are just `uv run pytest`. This also removes the README's reliance on `../.venv/Scripts/python.exe`, which is Windows-only.

### M6. Backend tests mutate the real database
- `app.main` runs `init_database()` at import against `backend/app/kanban.db`, which is committed to git.
- `test_board_route_persists_updates` (`test_board_persistence.py:18-41`) writes a two-column board and never restores it. This leaves the repo dirty and triggers the H4 reset.
- **Action:**
  - Point the database at a temp file in tests via a `conftest.py` fixture (`monkeypatch` `DB_PATH` plus `init_database()`).
  - `git rm --cached backend/app/kanban.db` and ignore `*.db`.

### M7. Schema is not actually ready for multiple users
- `board_columns.id` and `cards.id` are global primary keys (`database.py:45-70`), but ids such as `col-backlog` and `card-1` are per-board values. A second user's board would collide.
- **Action:** use composite primary keys `(board_id, id)` for `board_columns` and `cards`, and update `docs/kanban_schema.json`.

### M8. The Windows PowerShell scripts do not detect Docker failures
- `scripts/start.ps1:6-12` and `stop.ps1`: in PowerShell 5.1 a failing native command does not throw, so `try { docker info }` never reaches `catch`.
- **Action:** check `$LASTEXITCODE` after `docker info` and `docker compose`.

### M9. Start scripts behave inconsistently
- `start.sh` runs in the foreground and tears down first. `start.ps1` and `start.bat` run detached and poll `/api/health`.
- **Action:** make all three detached, polling health, matching the Windows scripts.

### M10. End-to-end tests never exercise the backend
- `playwright.config.ts` starts `next dev` only. `/api/*` does not exist there, so the board falls back to `initialData` and saves fail silently.
- The e2e tests pass without testing persistence, login-to-board loading, or AI refresh.
- **Action:** point Playwright at the FastAPI app serving the built frontend (`baseURL: http://127.0.0.1:8000`, `webServer` running uvicorn after `npm run build`). Add a test that reloads the page and asserts a moved card persisted.

---

## Low

### L1. Dead defensive code (against the coding standards)
- `KanbanBoard.tsx:95,99,118,130,150`: null checks on `board`, whose type is non-nullable. Revisit after H2.
- `KanbanBoard.tsx:28-30`, `AiChatSidebar.tsx:18-20,26-28`: `typeof window` branches in client-only code. Use relative URLs (`fetch("/api/board")`) and delete the helpers.
- `service.py:69-74`: missing-card check that the `BoardDataModel` validator already guarantees.
- `main.py:61-65,78-82`: `except Exception` safety nets. FastAPI already returns 500. Map `httpx.HTTPError` to 503 explicitly in `openrouter_client.py` instead.

### L2. Duplication
- The board URL helper and `BOARD_REFRESH_EVENT` are defined in both `KanbanBoard.tsx` and `AiChatSidebar.tsx`. Move them to `src/lib/api.ts`.
- `createMessageId` duplicates `createId` in `lib/kanban.ts`. Use `crypto.randomUUID()` for both.
- The model name is hardcoded in `main.py:67` and `openrouter_client.py:6`. Import `MODEL`.
- `service.py:27-43` builds every `ColumnModel` twice. Build the list once.

### L3. Hand-rolled `.env` loader
- `openrouter_client.py:10-30` parses `.env` manually and re-reads it on every request.
- In Docker, `env_file` already sets the variable, and the extra `./.env:/app/.env` mount (`docker-compose.yml:9-10`) is redundant.
- **Action:** drop the mount. Either keep a single load at import or use `python-dotenv`, and remove the per-call reload.

### L4. Structured AI output
- The system prompt asks for JSON only, and `ai_flow.py:31-57` strips code fences and falls back to the first and last braces.
- **Action:** send `response_format` with a JSON schema (OpenRouter supports structured outputs for compatible models). If `qwen/qwen3.8-27b:free` does not support it, keep the parser but add the board rules from H4 to the prompt.
- Conversation history is unbounded. Consider sending only the last N messages.

### L5. Static serving gaps
- `main.py:30-31,87-91` serves only `/` and `/_next`. `favicon.ico` and the other files in `out/` return 404.
- A missing build raises `FileNotFoundError`, which produces a 500.
- **Action:** mount `StaticFiles(directory=STATIC_DIR, html=True)` at `/` after the API routes are registered. This replaces the custom `/` handler.

### L6. Seed data card order
- `database.py:138` seeds every card with `sort_order` 0, so order within a column depends on SQLite row order until the first save.
- **Action:** use each card's index within its column.

### L7. `column_key` is written with the column id
- `service.py:65` inserts `column.id` (e.g. `col-backlog`) as `column_key`, while the seed data and schema doc use `backlog`.
- **Action:** with H4 in place, columns never change, so save should `UPDATE` titles only and leave `column_key` alone. Alternatively, drop the `column_key` column.

### L8. Minor cleanups
- `docker-compose.yml:13-14`: `APP_ENV` is never read. Remove it.
- `sqlite3` connections are never closed (`with conn` only commits). Wrap with `contextlib.closing`.
- `handleAddCard` stores the placeholder `"No details yet."` as real data (`KanbanBoard.tsx:172`). Store `""` and render the placeholder in the UI.
- `frontend/test-results/.last-run.json` is committed. Add `test-results/` and `playwright-report/` to `frontend/.gitignore`.
- The Starlette deprecation warning in pytest: follow its instruction when upgrading dependencies.
- Node 20 in `Dockerfile:1`: move to the current LTS image.

### L9. Documentation drift
- `frontend/AGENTS.md` still says there is no backend, no login and no persistence.
- `backend/AGENTS.md` and `scripts/AGENTS.md` are placeholders.
- `docs/kanban_schema.json` `api_contract_expectations.board_payload` lists `id` and `userId`, which the API does not return.
- The PLAN "Current project baseline" section describes the pre-integration state.
- **Action:** update these after the fixes above land.

---

## Recommended order of work

1. **Data safety:** H1, H2, H4, H5 and M6. These are small, related changes to `KanbanBoard.tsx`, `schemas.py`, `database.py`, `docker-compose.yml` and a test fixture.
2. **Missing requirement:** H3 (card editing).
3. **Green toolchain:** M2, M3, then add lint and typecheck to the documented test commands.
4. **Build and ops:** M4, M5, M8, M9.
5. **AI correctness:** M1, L4.
6. **Test realism:** M10.
7. **Cleanup and docs:** M7, remaining Low items, L9.

Each step should end with backend `pytest`, frontend `vitest`, `eslint`, `tsc --noEmit` and Playwright passing.

---

## Status (2026-09-27)

All findings above have been addressed, in steps 1-7:

- Data safety (H1, H2, H4, H5, M6), card editing (H3), and a clean toolchain (M2, M3).
- Build and ops (M4, M5, M8, M9), AI correctness (M1, L4), and test realism (M10).
- Cleanup (M7, L1-L8) and docs (L9).

Final checks: backend 21 passed, frontend unit 22 passed, Playwright 9 passed, lint and typecheck clean.

Open items:

- Structured output (`response_format`) has not been verified against the live model. Every live call returned an upstream 429 from the free tier.
- If the user edits the board while an AI request is in progress and the AI returns a board, the AI's board replaces that edit.
- Databases created before M7 keep the old single-column primary keys (`CREATE TABLE IF NOT EXISTS` does not change existing tables). They still work for the single MVP board. A new database gets the composite keys.

Fixed after step 7: narrow columns. Below 1536px the chat now sits under the board, the page max width is 1800px, and card buttons sit under the text. At 1280px, columns went from 150px to 227px and cards from 306px to 196px tall.
