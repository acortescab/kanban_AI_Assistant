# Frontend agent notes

Next.js + React UI for the project management app. It is built as a static export (`output: "export"`) and served by the FastAPI backend; it talks to the backend through same-origin `/api/*` calls. The session is an HttpOnly cookie, so the frontend never sees a token.

## Stack

- Next.js 16, React 19, TypeScript
- Tailwind CSS 4 (colors are CSS variables in `src/app/globals.css`, matching the root AGENTS.md scheme)
- @dnd-kit for drag and drop
- Vitest + Testing Library for unit tests, Playwright for e2e

## Structure

- `src/lib/api.ts`: every backend call, typed. Errors become `ApiError` with the server's `detail` (validation lists are flattened to their first message). Any 401 other than a failed login fires `UNAUTHORIZED_EVENT`.
- `src/lib/kanban.ts`: board and card types (priority, `dueDate` as `YYYY-MM-DD` or null, labels), `newCard`, `moveCard`, column helpers, label parsing, overdue check. Limits mirror `backend/app/schemas.py`.
- `src/app/page.tsx`: checks the session with `GET /api/auth/me`, then shows `AuthScreen` or `Workspace`. Listens for `UNAUTHORIZED_EVENT` to drop back to sign in.
- `src/components/AuthScreen.tsx`: sign in and register.
- `src/components/Workspace.tsx`: header (board switcher, All boards, Account, Users for admins, Log out) and the current view: a board, the boards overview, account settings, or the admin screen. Remembers the last opened board per user in localStorage (convenience only).
- `src/components/BoardsOverview.tsx`: board tiles with counts, create and delete (with confirm).
- `src/components/KanbanBoard.tsx`: one board. Toolbar (editable title and description, stats, Members and AI chat toggles), filter bar, columns, add column, and the chat. Persists every change with `PUT /api/boards/{id}/data` through a queue so saves are sent one at a time, each with `If-Match` set to the last known version. A failed save (409 when someone else changed the board) reloads the stored board and drops saves queued behind it. AI edits arrive already saved and are applied with their version. Drag and drop saves on drop only.
- `src/components/CardFilterBar.tsx`: text search, priority, label and overdue filters. Filtering only hides cards (`matchesFilter` in `lib/kanban.ts`).
- `src/components/BoardMembers.tsx`: members panel. The owner shares by username and removes members; a member can leave. `KanbanBoard` owns the member list (it also feeds the assignee picker and filter) and reloads the board after a removal, since the server unassigned that person's cards.
- `src/components/BoardActivity.tsx`: activity feed panel; refetches whenever the board changes.
- Columns can be reordered with the chevrons in their header (`moveColumn`). Cards can be assigned to a board member (initials badge, "Assigned to me" filter).
- `src/components/KanbanColumn.tsx`: droppable column with an editable title and a delete button (enabled only for an empty column when more than one exists).
- `src/components/KanbanCard.tsx`: sortable card with a drag handle, badges (priority, due / overdue, labels), inline edit of every field, and delete.
- `src/components/AiChatSidebar.tsx`: chat with `POST /api/boards/{id}/ai/chat`. Waits for pending saves before sending, sends at most `MAX_SENT_HISTORY` past messages, and applies a returned board through `onBoardUpdate`.
- `src/components/AccountSettings.tsx`, `src/components/AdminUsers.tsx`: account self-service and user management.

## Commands

```bash
npm run dev            # UI only; there is no backend on :3000, so nothing loads
npm run build          # static export to out/
npm run lint
npm run typecheck
npm run test:unit
npm run test:coverage  # unit tests with coverage (text + html in coverage/)
npm run test:e2e       # builds, runs the real backend on :8001 with a temp DB and an OpenRouter stub
```

## Testing notes

- Unit tests run against `src/test/fakeServer.ts`, an in-memory stand-in for the backend installed as `global.fetch`. It seeds the demo user and `board-1`, and `server.interceptor` lets a test fail or delay any request.
- E2E tests share one database per run. Tests on the demo board use different cards; tests of accounts and boards register their own unique user. A page reload keeps the session, so `reopen()` (not a second sign in) proves persistence.
- They wait on the board's `data-saves-completed` counter rather than the "Saving" badge, because the badge is only correct for the render that produced it.
- Next.js renders an empty `role="alert"` route announcer, so e2e tests find messages by text, not by the alert role.
- dnd-kit puts `role="button"` on each card's drag handle, not on the card itself, so the card body has no role. Scope button queries to the card, or target the handle by its `card-handle-<cardId>` test id.
