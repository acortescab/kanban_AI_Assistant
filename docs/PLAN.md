# Project Plan

This plan breaks the MVP into concrete phases with executable checklists, validation steps, and clear success criteria. The work should proceed in order and each phase should be considered complete only after the relevant tests or checks pass.

## Current implementation decisions

These design and operational decisions reflect the latest implementation state and should be treated as the current baseline for continued work:

- Local-first Docker stack: the app runs in a single local container via Docker Compose, with the backend serving the built frontend at /.
- SQLite persistence: the backend stores board state in a local SQLite database and initializes it automatically when absent.
- Single-user MVP: login is hardcoded to user / password, and the app supports one active board for the signed-in user.
- Fixed five-column board: the canonical board layout is Backlog, Discovery, In Progress, Review, and Done.
- Board data contract: the frontend and backend share the same BoardData structure with a columns array and cards object keyed by card id.
- Frontend architecture: Next.js handles the UI, while FastAPI owns persistence and health endpoints; static frontend output is served from the backend.
- Operational stability: startup and shutdown scripts keep the stack controllable and avoid stale local state by restarting cleanly.
- OpenRouter integration: the API key lives in the project .env file and the backend connects with the qwen/qwen3.8-27b:free model.
- Docker-safe styling: external Google Fonts were removed from the frontend because they break container builds when the environment cannot fetch them at build time; system fonts are used instead.
- Scope guardrails: no full auth system, no multi-board management, and no over-engineering beyond the approved MVP requirements.

## Part 1: Plan and project documentation

Goal: confirm the execution plan, document the current frontend baseline, and get approval before implementation begins.

Checklist:
- [x] Review the root project requirements and constraints in AGENTS.md.
- [x] Review the current frontend implementation and test setup.
- [x] Expand this plan into detailed implementation steps with testing gates.
- [x] Create a frontend AGENTS.md describing the current codebase and working conventions.
- [x] Confirm the plan with the user before starting build work.

Tests / validation:
- Verify that the frontend AGENTS.md reflects the actual structure, scripts, and app behavior currently in the project.
- Verify that the plan includes explicit phases, test coverage, and success criteria for each step.

Success criteria:
- The user has reviewed and approved the implementation plan.
- There is a single source of truth for the phased delivery order in docs/PLAN.md.
- The team can start from the documented frontend baseline with no ambiguity about the current state.

---

## Part 2: Scaffolding the containerized app

Goal: establish the local runtime stack, including Docker, backend scaffolding, and operating scripts.

Checklist:
- [x] Create Docker configuration for the app stack.
- [x] Set up backend/ as a FastAPI application.
- [x] Add Python dependency management using uv in the container workflow.
- [x] Add scripts/ start and stop scripts for Mac, PC, and Linux.
- [x] Verify the app serves a basic "hello world" page from the backend.
- [x] Verify the backend exposes a basic API endpoint that returns a sample payload.
- [x] Confirm the app runs locally through the provided scripts.

Implementation notes:
- Keep the initial backend simple: a basic FastAPI app served by the container and responding on a health or root endpoint.
- The frontend is not yet integrated; this phase is only to prove the runtime stack works.
- Use local development scripts to make startup and teardown consistent across operating systems.

Tests / validation:
- Run the app locally in Docker or the equivalent local stack.
- Request the root route and confirm the expected HTML response.
- Request the API route and confirm a JSON response is returned.

Success criteria:
- A developer can start the local app via scripts without manual environment setup surprises.
- The app responds on at least one root page and one API endpoint.
- The runtime is stable enough to continue integrating the frontend.

---

## Part 3: Add the frontend into the delivery path

Goal: make the app serve the Next.js frontend at / and ensure the Kanban demo is visible in the built app.

Checklist:
- [x] Configure the backend to serve the static Next.js build at /.
- [x] Add the build step for the frontend so it can be statically generated or served from the container.
- [x] Ensure the app renders the existing Kanban board at the root route.
- [x] Preserve the frontend demo behavior already built in the current frontend directory.
- [x] Add or confirm unit and integration tests covering the board UI.

Implementation notes:
- This phase should use the current frontend MVP as the baseline rather than redesigning the board.
- Keep behavior stable: board renders, cards can be added or removed, columns can be renamed, drag and drop works.

Tests / validation:
- Run the frontend unit tests.
- Run the frontend integration tests where present.
- Verify the rendered app on / matches the intended Kanban board.

Success criteria:
- The root route serves the board successfully.
- The app can be built and served through the containerized stack.
- The existing demo functionality remains intact.

---

## Part 4: Fake sign-in flow

Goal: gate access to the Kanban behind a simple login screen using the dummy credentials user / password.

Checklist:
- [x] Add a login screen that appears when visiting / before authentication.
- [x] Accept the hardcoded credentials user and password.
- [x] Show the board only after successful authentication.
- [x] Allow the user to log out and return to the login screen.
- [x] Maintain the MVP assumption that only one local user is supported.
- [x] Add tests for successful login, failed login, and logout flow.

Implementation notes:
- This is a fake sign-in experience only; no full auth system or database auth table is needed.
- The login state should be simple and local to the frontend for this MVP.

Tests / validation:
- Attempt login with valid credentials and verify the board appears.
- Attempt login with invalid credentials and verify the page blocks access.
- Log out and verify the login page is shown again.

Success criteria:
- The app is inaccessible without login.
- The valid dummy credentials work as expected.
- The user can logout cleanly and return to a signed-out state.

---

## Part 5: Database modeling and schema proposal

Goal: define the persisted Kanban model for future backend integration and obtain user sign-off before implementation.

Checklist:
- [x] Define the Kanban data model for users, board data, columns, cards, and relationship structure.
- [x] Save the schema proposal as JSON in docs/.
- [x] Document the database approach and assumptions in project documentation.
- [x] Confirm the schema supports multiple users in the future while the MVP remains single-user.
- [x] Get explicit user sign-off on the schema before backend persistence logic is built.

Implementation notes:
- Use SQLite as the database engine, with schema designed for future extension.
- Keep the MVP simplified to one board per user while making the base structure ready for multiple users.
- The board data model tracks a single active user in the MVP, while the schema remains capable of expansion to multiple users and multiple boards over time.

Tests / validation:
- Check that the schema can represent the board state and user data without ambiguity.
- Confirm the JSON proposal matches the actual planned API payloads.
- Verify the schema is consistent with the existing frontend board structure and the eventual backend persistence contract.

Success criteria:
- The schema is documented clearly.
- The user approves the database direction before backend integration work begins.
- The planned schema aligns with the app’s functional requirements.

Approved schema proposal:
- See docs/kanban_schema.json for the persisted model and relationship structure.
- The app uses a `users` table, a `boards` table, a `board_columns` table, and a `cards` table.
- Each user can own one board in the MVP, with the data model ready for future multi-board and multi-user expansion.

---

## Part 6: Backend API for persisted board data

Goal: add backend routes to read and modify the Kanban for one user, creating the SQLite database if it does not already exist.

Checklist:
- [x] Design the backend API contract for reading and updating board state.
- [x] Implement SQLite initialization with automatic database creation.
- [x] Add routes for fetching the board for a signed-in user.
- [x] Add routes for updating the board and toggling card or column state.
- [x] Add backend unit tests covering success and failure cases.
- [x] Ensure the API handles missing data safely and creates storage when needed.

Implementation notes:
- The board should be persisted for the active user.
- The API should be structured to support future multi-user data access without redesigning the whole backend.
- The board contract uses the same JSON shape as the frontend board model: columns and a cards object keyed by card id.

Tests / validation:
- Unit tests for database initialization.
- Unit tests for loading a board from storage.
- Unit tests for saving a modified board state.
- Tests for empty or invalid payload handling.

Success criteria:
- Backend routes can read and write the board without manual database setup.
- The database is created automatically when it does not exist.
- Unit test coverage is strong enough to catch regressions in board state logic.

---

## Part 7: Connect the frontend to the backend API

Goal: make the frontend use real persisted data instead of ephemeral local state.

Checklist:
- [x] Replace local-only board state with API-backed reads and writes.
- [x] Load the current board from the backend on app load.
- [x] Save board changes after rename, add-card, remove-card, and drag-and-drop actions.
- [x] Handle loading and save states gracefully.
- [x] Test the end-to-end persistence flow with high coverage.

Implementation notes:
- Maintain the existing UI experience, but store board state in the backend.
- Use the same board model on both frontend and backend to keep the contract simple.
- For the MVP, the frontend should call the backend endpoints once the user logs in and persist the board state after each discrete update.

Tests / validation:
- Frontend tests for loading state.
- Frontend tests for save operations after user actions.
- Integration tests for board persistence end-to-end.

Success criteria:
- A board can be modified in the UI and persist after refresh.
- The frontend and backend agree on the board structure and shape.
- The app behaves as a real persistent board rather than a static demo.

---

## Part 8: OpenRouter connectivity

Goal: validate that the backend can call OpenRouter and receive a response.

Checklist:
- [x] Add OpenRouter configuration with the expected API key and model.
- [x] Add a minimal backend route or utility for a simple AI test call.
- [x] Run a simple prompt such as 2 + 2 and confirm the expected output.
- [x] Handle configuration errors or missing API keys without failing silently.
- [x] Confirm the app logs or surfaces meaningful errors for AI connectivity failures.

Implementation notes:
- This phase is purely connectivity validation; no business logic yet.
- The model is the one specified in the project requirements: qwen/qwen3.8-27b:free.

Tests / validation:
- Backend connectivity test using a basic arithmetic prompt.
- Verify the response format is usable by the application.

Success criteria:
- The backend can successfully call OpenRouter and receive a real response.
- The app can detect and report missing or invalid AI configuration.

---

## Part 9: AI board-aware structured output flow

Goal: build the production AI interaction so it receives the current board plus the user prompt and returns structured output with both a response and optional board edits.

Checklist:
- [x] Extend the backend AI request to include the full Kanban JSON.
- [x] Include user question text and conversation history in the prompt payload.
- [x] Add a structured response schema with both textual response and optional board changes.
- [x] Parse and validate structured AI output before applying it.
- [x] Apply board updates only when the AI response includes valid edits.
- [x] Test both conversational replies and board mutation scenarios.

Implementation notes:
- The AI may update the board or simply answer a question; both should be handled gracefully.
- The response model should be explicit and simple to validate.
- Confirmed defaults: send the full conversation history, allow full board replacement in the structured edit payload, and reject the whole response if any board-edit portion is malformed.

Tests / validation:
- Unit tests for prompt construction.
- Unit tests for parsing valid structured responses.
- Negative tests for malformed AI output.
- End-to-end tests for board update requests issued by the AI.

Success criteria:
- The AI can answer user questions using board context.
- The AI can request board updates in a controlled, validated structure.
- Invalid or partial AI output does not corrupt the board state.

---

## Part 10: Sidebar AI chat UI and auto-refresh

Goal: provide an in-app AI chat experience that can update the board and refresh automatically when the AI modifies it.

Checklist:
- [x] Add a sidebar chat widget in the UI.
- [x] Support sending messages and showing conversation history.
- [x] Connect the chat to the backend AI flow.
- [x] Render AI responses in the UI.
- [x] If the AI returns a valid board update, refresh the board automatically.
- [x] Add comprehensive UI tests covering chat interactions and board refresh behavior.

Implementation notes:
- The chat sidebar should be visually consistent with the project color scheme and app style.
- The interface should remain simple and focused on the MVP.

Tests / validation:
- UI tests for sending a prompt to the AI.
- UI tests for receiving a response.
- UI tests for board refresh after AI-driven changes.

Success criteria:
- A user can chat with the AI in a sidebar.
- The AI can make valid board modifications and the UI updates without manual refresh.
- The complete user flow works from prompt to persisted board update.

---

## Current project baseline

All ten parts are complete, and the follow-up fixes from docs/code_review.md have been applied. The app runs as a single Docker container. The board persists in SQLite on the `kanban-data` volume, supports add, edit, delete, rename and drag-and-drop, and the AI sidebar can read and change it. Tests: backend pytest, frontend Vitest, and a Playwright suite that runs against the real backend with an OpenRouter stub.

## Completion gate before moving to implementation

Implementation work should not begin until the user explicitly approves this plan. Once approved, the agent should proceed in order from Part 2 onward and only complete one phase at a time.