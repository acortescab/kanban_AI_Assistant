# Frontend agent notes

Next.js + React UI for the Kanban MVP. It is built as a static export (`output: "export"`) and served by the FastAPI backend; it talks to the backend through same-origin `/api/*` calls.

## Stack

- Next.js 16, React 19, TypeScript
- Tailwind CSS 4 (colors are CSS variables in `src/app/globals.css`, matching the root AGENTS.md scheme)
- @dnd-kit for drag and drop
- Vitest + Testing Library for unit tests, Playwright for e2e

## Structure

- `src/app/page.tsx`: fake sign-in (`user` / `password`, frontend-only) and logout; renders `KanbanBoard` once signed in.
- `src/components/KanbanBoard.tsx`: loads the board from `GET /api/board`, owns board state, and persists every change with `PUT /api/board` through a queue so saves are sent one at a time. Shows nothing editable until the load succeeds. Drag and drop saves on drop only.
- `src/components/KanbanColumn.tsx`: droppable column with an editable title (saved on Enter or blur, only when changed).
- `src/components/KanbanCard.tsx`: sortable card with a drag handle, inline edit (title and details), and remove.
- `src/components/NewCardForm.tsx`: add-card form.
- `src/components/AiChatSidebar.tsx`: chat with `POST /api/ai/chat`. It waits for pending board saves before sending, and applies a returned board through `onBoardUpdate`.
- `src/lib/kanban.ts`: board types, `moveCard`, `createId`, and `initialData` (used as a test fixture).

## Commands

```bash
npm run dev         # UI only; there is no backend on :3000, so the board will not load
npm run build       # static export to out/
npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e    # builds, runs the real backend on :8001 with a temp DB and an OpenRouter stub
```

## Testing notes

- Unit tests mock `fetch`; see `mockBoardApi` in `KanbanBoard.test.tsx`.
- E2E tests share one database per run, so each test uses different cards. They wait on the board's `data-saves-completed` counter rather than the "Saving" badge, because the badge is only correct for the render that produced it.
- dnd-kit puts `role="button"` on each card's drag handle, not on the card itself, so the card body has no role. Scope button queries to the card, or target the handle by its `card-handle-<cardId>` test id.
