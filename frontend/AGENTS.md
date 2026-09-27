# Frontend agent notes

This folder contains the current frontend MVP for the Kanban project. It is a standalone Next.js + React application that demonstrates the board UI before backend integration.

## Current stack

- Next.js 16
- React 19
- TypeScript
- Vite + Vitest for unit tests
- Playwright for UI/integration tests
- @dnd-kit for drag-and-drop interactions
- Tailwind CSS for styling

## Project structure

- src/app/page.tsx: renders the home page and mounts the Kanban board.
- src/components/KanbanBoard.tsx: main board composed of columns and drag-and-drop behavior.
- src/components/KanbanColumn.tsx: a droppable column that renders cards and the add-card form.
- src/components/KanbanCard.tsx: cards rendered as sortable items with delete behavior.
- src/components/NewCardForm.tsx: compact form for adding a card to a column.
- src/lib/kanban.ts: board data model and drag logic, including moveCard and createId.
- src/components/KanbanBoard.test.tsx: UI tests for the board behavior.
- src/lib/kanban.test.ts: tests for drag-and-drop and movement logic.
- tests/kanban.spec.ts: Playwright test coverage for the front-end demo.

## Current behavior

The app currently shows a single board with five default columns:
- Backlog
- Discovery
- In Progress
- Review
- Done

Each column contains cards and supports:
- renaming a column title
- adding a new card
- removing a card
- dragging a card between columns or within a column

## Important working assumptions

- This is still a frontend-only MVP and does not yet talk to the backend.
- There is no user login yet; the app is currently visible without authentication.
- The board state is local in React state and is not persisted.
- Styling follows the design system defined in the root AGENTS.md.

## Validation commands

Run the frontend test suite from this directory:

```bash
npm install
npm run test
```

Run the app locally:

```bash
npm run dev
```

Run the production build:

```bash
npm run build
```

## Notes for future work

This frontend is the working baseline for the eventual full app. The later phases will adapt it to:
- login gating
- backend API persistence
- AI chat sidebar integration
- automatic board refresh after AI updates

Keep changes consistent with the existing design and test structure, and avoid over-engineering the implementation while the project remains in MVP stage.
