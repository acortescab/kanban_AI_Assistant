# Kanban AI Assistant

Local-first project management app with a Next.js frontend, a FastAPI backend, SQLite persistence, and an AI chat sidebar powered by OpenRouter.

## What it does

- Accounts: register, sign in (session cookie), change display name and password, delete your account
- A demo admin account is seeded: `user` / `password`
- Multiple boards per user: create, rename, describe, switch, delete
- Board sharing by username; members edit together, and a change based on an outdated copy is refused (the latest board is shown) instead of overwriting someone's work
- Card search and filters (text, priority, label, assignee, overdue)
- Cards can be assigned to board members; columns can be reordered
- Per-board activity history (who added, moved, edited, assigned or deleted what, including AI edits)
- Configurable columns (add, rename, delete empty ones; up to 12) with drag-and-drop cards
- Cards with details, priority, due date (overdue highlighting) and labels; board stats
- Admin screen to promote, demote and remove users
- AI sidebar chat per board that can answer questions and edit the board (it can never delete cards)

## Run locally

1. Make sure Docker is running.
2. Create `.env` in the project root with your OpenRouter key:

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

3. Start the stack:

```bash
./scripts/start.sh        # Windows: scripts\start.ps1 or scripts\start.bat
```

4. Open the app at `http://localhost:8000`.

To stop the stack:

```bash
./scripts/stop.sh         # Windows: scripts\stop.ps1 or scripts\stop.bat
```

Board data is stored in the `kanban-data` Docker volume and survives restarts.

## Configuration

- The OpenRouter API key lives in the root `.env` file as `OPENROUTER_API_KEY`; `.env.example` is the template.
- The start scripts refuse to run unless `.env` exists and sets a non-empty key.
- The Docker Compose setup mounts that file into the API container.
- The backend uses `qwen/qwen3.8-27b:free`. That model is free and sits behind a shared upstream pool, so it returns HTTP 429 under load; retrying later or adding your own provider key avoids it.

## Tests

Frontend:

```bash
cd frontend
npm run lint
npm run typecheck
npm run test:unit
npm run test:coverage   # unit tests with a coverage report
npm run test:e2e
```

The e2e suite builds the frontend and serves it through the backend with `uv`, so `uv` must be installed.

Backend:

```bash
cd backend
uv run pytest
uv run pytest --cov=app --cov-report=term-missing   # with coverage
```

The default backend run never calls OpenRouter. To exercise the real model, opt in:

```bash
cd backend
uv run pytest -m live
```

These live tests skip rather than fail when the model is rate limited.

## Project layout

- `backend/` FastAPI app, SQLite persistence, and AI integration
- `frontend/` Next.js UI and board interactions
- `docs/` planning and schema documentation
- `scripts/` start and stop helpers for the local Docker stack
- `.github/workflows/ci.yml` runs the same gates on every push and pull request