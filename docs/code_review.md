# Code Review

Date: 2026-09-27
Scope: entire repository at commit `f8b6ec5` (backend, frontend, Docker, scripts, tests, docs).
Supersedes the review written at `9125023`; previous-finding status is tracked in the last section.

## Current health

| Check | Result |
|---|---|
| Backend `uv run pytest` | 29 passed, 3 live deselected |
| Frontend `npm run test:unit` | 26 passed (3 files) |
| Frontend `npm run lint` | clean |
| Frontend `tsc --noEmit` | clean |
| Frontend `npm run test:e2e` | 9 passed (Chromium) |
| Backend `uv run pytest -m live` | opt-in; 2 passed, 1 skipped (upstream rate limit) |

The toolchain is genuinely green. The previous review's claim that every finding was addressed is verified: the fixed-column validator, the removal of the `initialData` fallback, the card editor, the serialized save queue, the Docker volume, the test database isolation and the real-backend e2e suite are all present and working.

What remains are correctness problems that the test suites structurally cannot catch, plus the fact that no gate enforces any of it.

## Summary

The architecture is right for the MVP: one container, one board, one JSON contract shared by both sides, and a validator that enforces the fixed columns. The remaining risk is concentrated in the AI feature and in the save path, not in the board mechanics.

- The AI response path can silently desynchronize the UI from the database (H1).
- The AI is allowed to delete the entire board, and the storage design makes that unrecoverable (H2).
- The AI has never been run against the real model, and the structured-output parameter is very likely being ignored (H3).
- Nothing enforces the lint, typecheck and test gates that CLAUDE.md calls mandatory (M4).

Severity: **High** = silent data loss or an unverified core feature. **Medium** = incorrect behavior, a broken gate, or an accessibility gap. **Low** = cleanup, simplification, or documentation drift.

---

## High

### H1. An AI board update can silently overwrite itself on the server

- `KanbanBoard.tsx:257-260` passes `waitForSaves={() => saveQueue.current}` and `onBoardUpdate={setBoard}`.
- `waitForSaves` resolves the queue *as it exists when the request is sent*. Any edit made after that snapshot appends a new PUT carrying the pre-AI board.
- `onBoardUpdate` bypasses `updateBoard` entirely, so the AI's board is never queued. The pending user PUT therefore lands *after* the backend's own AI save.
- Result: the database holds the pre-AI board while the screen shows the AI's board. No error is raised anywhere. The user's edit is gone from the server and the discrepancy only surfaces on the next reload.
- The test at `KanbanBoard.test.tsx:239-269` proves the ordering *before* the request but says nothing about the window *during* it, so the suite passes while the bug is live.
- **Action:** route the AI's board through the same save queue as user edits, so whichever write is enqueued last is also written last. The redundant PUT is worth it: it makes the server match the screen deterministically. Add a test that enqueues a user edit while the AI request is in flight and asserts the final saved board is the AI's.

### H2. The AI can delete every card, and the storage design makes that unrecoverable

- `ai_flow.py:100-101` saves whatever board the model returns as a full replacement. `SYSTEM_PROMPT` (`ai_flow.py:24`) asks for exactly that.
- A hallucinated empty `cardIds` list, or a card quietly dropped from `cards`, passes `BoardDataModel` and is written. One bad completion wipes the board.
- `PLAN.md:258` records full board replacement as a "confirmed default", so this is an accepted design decision. The consequence still needs to be stated rather than absorbed.
- Recovery is not possible: `service.py:50-57` runs `DELETE FROM cards WHERE board_id = ?` and re-inserts every row, so the previous state is not in the database even transiently, and `created_at` on every card is overwritten (L1).
- **Action:** prefer a patch contract (the card ids to move, plus adds and edits) over a full replacement. If the replacement stays, keep the previous board and surface it: reject an AI board that drops more than a small number of cards, and have the assistant say so in its `response` text so the change is not silent.

### H3. The AI path has never been verified against the real model

- Every test mocks `httpx.post` (`test_ai_flow.py:25-34`, `test_openrouter.py:53-60`). The previous review's own status records that "every live call returned an upstream 429 from the free tier". The one feature that distinguishes this app has no evidence of working.
- `RESPONSE_FORMAT` (`ai_flow.py:12-18`) sends `{"type": "json_schema", "json_schema": {...}}` with no `"strict": true`. Pydantic's generated schema omits `cardIds` and `board` from `required` because they have defaults, which strict structured outputs reject outright. The parameter is therefore very likely ignored, which leaves `_strip_code_fences` and the brace-scanning fallback in `_load_json_object` (`ai_flow.py:48-74`) as the mechanism that actually keeps the feature alive.
- The fixed-column rule is enforced only as prose in `SYSTEM_PROMPT`. `model_validator` functions are invisible to `model_json_schema()`, so the emitted schema does not tell the model the one constraint it is most likely to break.
- 30 seconds (`openrouter_client.py:43`) for a full board JSON plus twenty history messages against a rate-limited free tier is also optimistic, and a timeout is reported as "Could not reach OpenRouter" (L5).
- **Action:** call `POST /api/ai/test` against the live model once and record the result in this file. If `response_format` is ignored, delete it and say so, rather than shipping an unverified parameter. Add a marked integration test that is skipped without an API key.

---

## Medium

### M1. A failed save leaves the board permanently out of sync and fails silently

- `KanbanBoard.tsx:86-93`: a rejected PUT sets the error message and is never retried. `isSaving` then clears, the screen keeps showing the unsaved board, and the only recovery is a manual reload, which discards every change made since the last successful save.
- Worse, the next successful save clears the error (`.then(() => setError(""))`, line 88). A transient failure followed by a successful save leaves the user believing nothing was lost, when an intermediate edit was in fact dropped from the database.
- **Action:** on failure, re-GET the board to resynchronize and tell the user which change was lost, or retry once inside the queue.

### M2. The e2e persistence assertions are racy and can pass without asserting anything

- `tests/kanban.spec.ts:13-15`: `expectSaved` waits for the "Saving" badge to reach count 0. The badge is rendered in the same React commit as the card change, so the preceding `toBeVisible()` and this assertion race. On a fast local PUT the badge may never appear, making the wait a no-op that resolves before the request is even sent.
- The next line is `signIn(page)`, which is a full `page.goto`. A navigation can cancel an in-flight `fetch`, so the "and persists it" assertion can be validating a save that was aborted mid-flight.
- **Action:** either drop `expectSaved` and rely on the post-reload assertion, which is the real check, or wait on a deterministic signal such as a `data-testid` marker toggled in the `.then()` of the PUT.

### M3. Cards cannot be moved with the keyboard, and the drag handle is a `role="button"` around real buttons

- `KanbanBoard.tsx:62-66` registers only `PointerSensor`. There is no `KeyboardSensor`, so a keyboard user can focus a card, read it, and open its editor, but can never move it. AGENTS.md:9 makes drag-and-drop a core requirement, so this excludes keyboard users from a primary feature.
- `KanbanCard.tsx:16-20, 43-52`: `useSortable` spreads `role="button"` and `tabIndex=0` onto the `<article>`, which contains the Edit and Remove `<button>` elements. Interactive content nested inside a button role is invalid for assistive technology and produces a confusing announcement.
- **Action:** add `KeyboardSensor` with `sortableKeyboardCoordinates`, and move the role and tab stop onto a dedicated drag-handle button instead of the whole card.

### M4. No CI, so none of the gates are enforced

- There is no `.github/` directory. `CLAUDE.md:30-31` declares `npm run lint` and `npm run typecheck` mandatory, and both pass today, but only because someone ran them.
- Every fix from the previous review is one careless commit away from regressing silently: the composite primary keys, the `FIXED_COLUMN_IDS` validator, the removal of the `initialData` fallback, the `.dockerignore` entries. Nothing would fail.
- **Action:** one workflow running `uv run pytest`, then `npm ci && npm run lint && npm run typecheck && npm run test:unit`, then `npm run test:e2e`. This is the highest-leverage single change for keeping the codebase honest, and it also fixes M5 for free.

### M5. Two of the three static-serving tests skip silently on a fresh clone

- `test_frontend_serving.py:16-18` skips on `STATIC_DIR is None`. `frontend/out` is gitignored, so on a clean checkout `uv run pytest` reports 21 passed and proves nothing about static serving. The skip reason is printed, but a green summary hides it.
- **Action:** building the frontend in CI (M4) removes the skip in practice. Until then, surface the skip count in the summary line.

### M6. A fresh clone cannot start the stack

- `docker-compose.yml:7-8` declares `env_file: .env` as mandatory and no `.env.example` is committed. `compose up` fails with a bare "env file not found", and `start.sh:12` aborts on that under `set -e` with no explanation.
- The failure is indirect on the AI side too: `load_dotenv` (`openrouter_client.py:8`) no-ops when the file is absent, so `POST /api/ai/test` returns 503 "Missing OPENROUTER_API_KEY" with no hint that the file was never created.
- **Action:** commit `.env.example`, and have `start.sh`, `start.ps1` and `start.bat` test for `.env` up front and print the one-line instruction to create it.

### M7. `updateBoard` derives the next board from the render closure

- `KanbanBoard.tsx:82-94` and every handler at lines 121-166 spread the `board` captured at render time rather than reading the current value.
- For direct user actions this is safe, because each is a separate event and React re-renders in between. It is not safe for the asynchronous AI path, which is exactly H1.
- **Action:** resolved together with H1 by routing all board writes through one queue.

---

## Low

### L1. Card timestamps are meaningless
`service.py:50-57` deletes and re-inserts every card on every save, stamping `now` into both `created_at` and `updated_at`. Only `boards.updated_at` reflects anything real. Either update cards in place, changing only `column_id` and `sort_order`, or stop writing the two columns.

### L2. Declared foreign keys are not enforced
`database.py:65-80` declares `FOREIGN KEY(board_id, column_id) REFERENCES board_columns(board_id, id)`, but SQLite ignores foreign keys unless `PRAGMA foreign_keys = ON`, which is never set. `get_board_record` then indexes by column id with no guard (`service.py:29`), so a dangling `column_id` raises `KeyError` and returns 500 on `GET /api/board`. Unreachable through the API today, which is why this is Low, but it is a latent 500 one bad write away. Either enable the pragma in `get_connection` or drop the declarations so they do not imply a guarantee that does not exist.

### L3. The service layer raises `HTTPException`
`service.py:3,16` imports from `fastapi`, so persistence is coupled to the transport, and a missing board surfaces as a 404 for a route the client never requested. `main.py` should own that mapping.

### L4. Broken CSS left over from removing Google Fonts
`globals.css:18` sets `--font-sans: var(--font-body)`, but `--font-body` is defined nowhere, so the token resolves to nothing. `.font-display` (line 32) hardcodes the same `"Segoe UI"` as `body`, so all six `font-display` headings are a no-op class. Remove both and either give the display face a real distinct stack or drop the class and its six usages.

### L5. Timeouts are misreported and the deadline is tight
`openrouter_client.py:43,52-53`: `ReadTimeout` is an `httpx.HTTPError`, so a slow free-tier model reports "Could not reach OpenRouter: ReadTimeout(...)", which sends the user looking at connectivity rather than at latency. Handle `httpx.TimeoutException` separately and raise the deadline above 30 seconds.

### L6. Dead scripts and unused dev dependencies
`package.json:8` defines `"start": "next start"`, which cannot work with `output: "export"`. Line 11 duplicates `test:unit` as `test`. `@vitest/coverage-v8` is installed with no `test:coverage` script and no threshold. `@types/node` is pinned to `^20` while the Dockerfile builds on Node 24.

### L7. The e2e suite shares one database and depends on declaration order
`tests/kanban.spec.ts:3` acknowledges the shared state, but "renames a column and persists it" leaves `col-review` titled "QA" and "deletes a card and persists it" removes `card-6` for the remainder of the run. Any future `fullyParallel`, a second worker, or a reorder breaks the suite. The database is written to `os.tmpdir()` with `Date.now()` (`playwright.config.ts:30`) and never cleaned up, so each run leaves a file behind.

### L8. Documentation drift
- `docs/PLAN.md:303` points at `docs/code_review.md` as the record of applied fixes; the file was deleted from the working tree and only restored by this review.
- `README.md:34` states that "the Docker Compose setup mounts that file into the API container". It does not: the mount was removed in favour of `env_file`, which injects variables rather than mounting a file.
- `docs/kanban_schema.json:59-62` documents `default: "Project Board"` on `boards.title`. `database.py:40-49` declares no DEFAULT and always inserts the literal, so the doc asserts a constraint the schema does not have.
- `frontend/AGENTS.md` is accurate. `backend/AGENTS.md` and `scripts/AGENTS.md` are accurate.

### L9. `KanbanColumn` writes to the DOM imperatively
`KanbanColumn.tsx:30-36` assigns `input.value` inside `commitTitle`. If the rename then fails to save, the input shows the new title while `column.title` and the header pill (`KanbanBoard.tsx:207-215`) still show the old one. The `key={column.title}` remount only happens on success, so the two never resynchronize on their own.

### L10. The AI conversation has no live region
`AiChatSidebar.tsx:128-144` renders messages into a plain `div`. A screen reader user receives no announcement when the assistant replies. `aria-live="polite"` on the message list is a one-attribute fix.

### L11. No request size limit on the chat endpoint
`AIChatRequestModel` (`schemas.py:62-66`) bounds `question` with `min_length` but nothing bounds `history`, and `ai_flow.py:42` sends the last 20 of whatever arrives. Locally this is harmless, but an unbounded `history` array is an unbounded prompt. `max_length` on the list closes it in one line.

---

## Previous findings: verified status

Every finding from the review at `9125023` was re-checked against the current code.

| Previous | Status | Evidence |
|---|---|---|
| H1 board not persisted across restarts | Fixed | `kanban-data` volume, `KANBAN_DB_PATH`, `docker-compose.yml:9-14` |
| H2 failed load overwrote saved board | Fixed | `board` starts `null`, nothing editable renders until the GET succeeds (`KanbanBoard.tsx:42,68-79`) |
| H3 card editing missing | Fixed | `KanbanCard.tsx` edit form; e2e at `tests/kanban.spec.ts:79` |
| H4 fixed columns not enforced | Fixed | `schemas.py:6,31-52`; two regression tests |
| H5 drag-over saved on every hover | Fixed | `onDragOver` highlights only; the save is in `onDragEnd` |
| M1 AI could overwrite the latest edit | Partly fixed | The client no longer sends a board and the backend reads its own, but the in-flight window remains (H1) |
| M2 lint error in `KanbanColumn` | Fixed | `npm run lint` clean |
| M3 TypeScript check failed | Fixed | `tsc --noEmit` clean |
| M4 Docker build copied local artifacts | Fixed | `.dockerignore` |
| M5 uv unidiomatic, no lockfile | Fixed | `uv.lock` committed, uv image pinned, `[dependency-groups]` |
| M6 tests mutated the real database | Fixed | `conftest.py` `tmp_path` fixture |
| M7 schema not multi-user ready | Fixed for new databases | Composite primary keys; older files keep single-column keys, as documented in `CLAUDE.md:44` |
| M8 PowerShell did not detect failures | Fixed | `$LASTEXITCODE` checks |
| M9 Start scripts inconsistent | Fixed | All three detached, polling `/api/health` |
| M10 e2e never hit the backend | Fixed | `playwright.config.ts` runs the real backend and an OpenRouter stub |
| L1-L8 cleanups | Done | No dead `typeof window` branches, no hand-rolled `.env` parser, seeded `sort_order` correct, `column_key` preserved, `test-results` untracked, `*.db` ignored |
| L9 documentation | Partly | `kanban_schema.json` updated; the README and PLAN drift is new (L8) |

---

## Recommended order of work

1. **Data integrity:** H1 and H2 together. Both are in `ai_flow.py` and the `KanbanBoard` save path, and fixing them together avoids touching that code twice.
2. **Prove the feature works:** H3. One live call, recorded in this file, decides whether `response_format` stays or goes.
3. **Enforce what exists:** M4, which also resolves M5. Smallest change with the largest effect on everything that follows.
4. **Correctness and access:** M1, M2, M3, M7.
5. **Fresh-clone experience:** M6, L8.
6. **Cleanup:** the remaining Low items.

Every step ends with backend `pytest`, frontend `lint`, `typecheck`, `test:unit` and `test:e2e` green, ideally from CI so the result is recorded rather than remembered.

---

## Resolution

All findings were worked through in the order above. The table records the outcome of each.

| Finding | Outcome |
|---|---|
| H1 | Fixed. The AI's board goes through the same `updateBoard` save queue as user edits, so the last enqueued write is the last write. Covered by "persists the AI board after an edit made while the request is in flight". |
| H2 | Fixed. `reject_removed_cards` raises before the save, and the prompt now says the AI must never remove a card. Three backend tests cover wiping the board, dropping one card, and the allowed cases. |
| H3 | Resolved by measurement, see below. |
| M1 | Fixed. A failed save now reloads the board from the server and shows an error that persists instead of clearing. |
| M2 | Fixed. The e2e suite waits on the board's `data-saves-completed` counter, so a `page.goto` can no longer cancel an in-flight PUT unnoticed. |
| M3 | Fixed. Cards are moved from a dedicated handle button that carries the dnd-kit role and the `KeyboardSensor` activator; the card body no longer has `role="button"` around real buttons. |
| M4 | Fixed. `.github/workflows/ci.yml` runs build, backend tests, lint, typecheck, unit, and e2e on every push and pull request. |
| M5 | Resolved by M4. The build runs before `pytest`, so `test_frontend_serving.py` no longer skips in CI. |
| M6 | Fixed. Added `.env.example`; all three start scripts refuse to run without a non-empty key. |
| M7 | Fixed. `updateBoard` derives the next board from the latest saved board, not the render closure. |
| L1 | Fixed. Each card keeps its original `created_at`; only `updated_at` advances. |
| L2 | Fixed. `PRAGMA foreign_keys = ON` per connection. No cascades, so deletes go children first. |
| L3 | Fixed. The service raises `LookupError`; the route maps it to 404. |
| L4 | Fixed. Removed the dangling `--font-sans: var(--font-body)`. `.font-display` was kept: it is used in six places, and with the Google font gone there is no other display stack to fall back on. |
| L5 | Fixed. Deadline raised to 120s, with a distinct message for a slow response versus an unreachable host. |
| L6 | Fixed. Dropped the `next start` script (it cannot work with `output: "export"`), the duplicate `test` script, and `@vitest/coverage-v8`. `@types/node` moved to `^24` to match the Dockerfile. |
| L7 | Fixed. The delete test creates and removes its own card, the rename test restores the seeded title, and the AI test is last because the stub's change is not undone. |
| L8 | Fixed. Schema notes corrected, the README gained the `.env` step and the live-test section, and the `AGENTS.md` files were updated for the new behaviour. |
| L9 | **Did not reproduce.** The title input is uncontrolled and keyed by the saved title, so a failed save reloads the board and remounts the input with the persisted value. The only way to make the original claim fail is to hold the input reference across the remount, which is a test bug, not a product bug. `KanbanColumn.tsx` is unchanged; a regression test now pins the resync. |
| L10 | Fixed. `aria-live="polite"` on the message list. |
| L11 | Fixed. `max_length` on the question, each message, the history list, and the card and column title fields. |

### H3 in detail

The AI path was measured against the real model rather than assumed.

- The key and the model id are both valid. A bad key returns 401; this one returns 429.
- `qwen/qwen3.8-27b:free` sits behind a shared upstream pool and fails often with
  `limit_source: "upstream_provider_shared_pool"`, provider `ModelRun`. It is intermittently
  available, so a failure says nothing about the code.
- When the pool allows a request, the model returns clean, unfenced JSON that matches the
  intended shape, the tolerant parser accepts it, and a card move is applied and persisted
  end to end.
- The generated `response_format` schema is not strict-compatible: `board`, `details` and
  `cardIds` carry defaults, so Pydantic omits them from `required` and OpenRouter strict mode
  would reject it. The schema is therefore advisory and the parser is the real safety net.
  That is now stated in the code rather than implied.
- `backend/tests/test_ai_flow_live.py` covers this. It is marked `live` and excluded by
  default through `addopts` in `backend/pyproject.toml`, and it skips instead of failing when
  the upstream is rate limited. Run it with `uv run pytest -m live`.

### Note on the L4 tradeoff

`layout.tsx` loads no font at all, so the display face is `body`'s stack. Giving the headings
a genuinely distinct face would mean reintroducing a webfont, which the project explicitly
avoids because it breaks container builds. The single-stack MVP is the intended tradeoff.
