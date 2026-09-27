export type Priority = "low" | "medium" | "high";

export type Card = {
  id: string;
  title: string;
  details: string;
  priority: Priority;
  dueDate: string | null; // YYYY-MM-DD
  labels: string[];
  assigneeId: string | null; // the board's owner or a member
};

export type Column = {
  id: string;
  title: string;
  cardIds: string[];
};

export type BoardData = {
  columns: Column[];
  cards: Record<string, Card>;
};

// Mirrors the backend limits in app/schemas.py.
export const MAX_COLUMNS = 12;
export const MAX_LABELS = 10;
export const MAX_LABEL_LENGTH = 30;

export const PRIORITIES: Priority[] = ["low", "medium", "high"];

export const priorityLabel = (priority: Priority) =>
  priority[0].toUpperCase() + priority.slice(1);

export const newCard = (
  id: string,
  title: string,
  details = "",
  fields: Partial<Omit<Card, "id" | "title" | "details">> = {}
): Card => ({
  id,
  title,
  details,
  priority: "medium",
  dueDate: null,
  labels: [],
  assigneeId: null,
  ...fields,
});

// Splits "a, b,,a" into ["a", "b"]: trimmed, non-empty, unique, capped like the backend.
export const parseLabels = (text: string) =>
  [...new Set(text.split(",").map((label) => label.trim()).filter(Boolean))]
    .map((label) => label.slice(0, MAX_LABEL_LENGTH))
    .slice(0, MAX_LABELS);

export const todayIso = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

// ISO dates compare correctly as strings.
export const isOverdue = (card: Card, today: string) =>
  card.dueDate !== null && card.dueDate < today;

export const formatDueDate = (dueDate: string) =>
  new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

export type CardFilter = {
  text: string;
  priority: Priority | "all";
  label: string; // "" means any label
  assignee: string; // "" means anyone, otherwise a user id
  overdueOnly: boolean;
};

export const EMPTY_FILTER: CardFilter = {
  text: "",
  priority: "all",
  label: "",
  assignee: "",
  overdueOnly: false,
};

export const isFilterActive = (filter: CardFilter) =>
  filter.text.trim() !== "" ||
  filter.priority !== "all" ||
  filter.label !== "" ||
  filter.assignee !== "" ||
  filter.overdueOnly;

// Text matches title, details or a label, case-insensitively; every set criterion must hold.
export const matchesFilter = (card: Card, filter: CardFilter, today: string) => {
  const query = filter.text.trim().toLowerCase();
  if (
    query &&
    ![card.title, card.details, ...card.labels].some((value) => value.toLowerCase().includes(query))
  ) {
    return false;
  }
  if (filter.priority !== "all" && card.priority !== filter.priority) {
    return false;
  }
  if (filter.label && !card.labels.includes(filter.label)) {
    return false;
  }
  if (filter.assignee && card.assigneeId !== filter.assignee) {
    return false;
  }
  return !filter.overdueOnly || isOverdue(card, today);
};

export const boardLabels = (board: BoardData) =>
  [...new Set(Object.values(board.cards).flatMap((card) => card.labels))].sort((a, b) =>
    a.localeCompare(b)
  );

export const addColumn = (board: BoardData, id: string, title: string): BoardData => ({
  ...board,
  columns: [...board.columns, { id, title, cardIds: [] }],
});

// Swaps a column with its neighbour; moving past either end leaves the board unchanged.
export const moveColumn = (board: BoardData, columnId: string, offset: -1 | 1): BoardData => {
  const from = board.columns.findIndex((column) => column.id === columnId);
  const to = from + offset;
  if (from === -1 || to < 0 || to >= board.columns.length) {
    return board;
  }
  const columns = [...board.columns];
  [columns[from], columns[to]] = [columns[to], columns[from]];
  return { ...board, columns };
};

// Up to two initials for an avatar badge: "Alice Smith" -> "AS", "bob" -> "B".
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

// Only empty columns can go, so no card is ever deleted as a side effect.
export const removeColumn = (board: BoardData, columnId: string): BoardData => ({
  ...board,
  columns: board.columns.filter(
    (column) => column.id !== columnId || column.cardIds.length > 0
  ),
});

// A drop target id is either a column's own id or the id of a card inside it.
const findColumn = (columns: Column[], id: string) =>
  columns.find((column) => column.id === id) ??
  columns.find((column) => column.cardIds.includes(id));

export const findColumnId = (columns: Column[], id: string) => findColumn(columns, id)?.id;

const withCardIds = (columns: Column[], cardIds: Record<string, string[]>) =>
  columns.map((column) =>
    Object.hasOwn(cardIds, column.id) ? { ...column, cardIds: cardIds[column.id] } : column
  );

// Dropping on a column appends the card; dropping on a card takes that card's place.
export const moveCard = (columns: Column[], activeId: string, overId: string): Column[] => {
  const activeColumn = findColumn(columns, activeId);
  const overColumn = findColumn(columns, overId);
  if (!activeColumn || !overColumn) {
    return columns;
  }
  const isOverColumn = overColumn.id === overId;

  if (activeColumn.id === overColumn.id) {
    if (isOverColumn) {
      const nextCardIds = [...activeColumn.cardIds.filter((cardId) => cardId !== activeId), activeId];
      return withCardIds(columns, { [activeColumn.id]: nextCardIds });
    }

    const oldIndex = activeColumn.cardIds.indexOf(activeId);
    const newIndex = activeColumn.cardIds.indexOf(overId);
    if (oldIndex === -1 || oldIndex === newIndex) {
      return columns;
    }
    const nextCardIds = [...activeColumn.cardIds];
    nextCardIds.splice(oldIndex, 1);
    nextCardIds.splice(newIndex, 0, activeId);
    return withCardIds(columns, { [activeColumn.id]: nextCardIds });
  }

  if (!activeColumn.cardIds.includes(activeId)) {
    return columns;
  }
  const nextOverCardIds = [...overColumn.cardIds];
  nextOverCardIds.splice(
    isOverColumn ? nextOverCardIds.length : nextOverCardIds.indexOf(overId),
    0,
    activeId
  );
  return withCardIds(columns, {
    [activeColumn.id]: activeColumn.cardIds.filter((cardId) => cardId !== activeId),
    [overColumn.id]: nextOverCardIds,
  });
};

export const createId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
