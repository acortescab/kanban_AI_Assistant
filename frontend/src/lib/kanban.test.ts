import {
  addColumn,
  boardLabels,
  EMPTY_FILTER,
  initials,
  isFilterActive,
  matchesFilter,
  moveColumn,
  findColumnId,
  isOverdue,
  moveCard,
  newCard,
  parseLabels,
  removeColumn,
  todayIso,
  type BoardData,
  type Column,
} from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });

  it("moves a card into an empty column", () => {
    const emptyColumns: Column[] = [
      { id: "col-a", title: "A", cardIds: ["card-1"] },
      { id: "col-b", title: "B", cardIds: [] },
    ];

    const result = moveCard(emptyColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual([]);
    expect(result[1].cardIds).toEqual(["card-1"]);
  });
});

describe("moveCard edge cases", () => {
  const columns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("returns the same columns for unknown ids", () => {
    expect(moveCard(columns, "card-x", "col-b")).toBe(columns);
    expect(moveCard(columns, "card-1", "col-x")).toBe(columns);
  });

  it("moves a card to the end when dropped on its own column", () => {
    expect(moveCard(columns, "card-1", "col-a")[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("finds the column of a card or column id", () => {
    expect(findColumnId(columns, "card-3")).toBe("col-b");
    expect(findColumnId(columns, "col-a")).toBe("col-a");
    expect(findColumnId(columns, "nope")).toBeUndefined();
  });
});

describe("card helpers", () => {
  it("creates cards with default fields", () => {
    expect(newCard("card-1", "Title")).toEqual({
      id: "card-1",
      title: "Title",
      details: "",
      priority: "medium",
      dueDate: null,
      labels: [],
      assigneeId: null,
    });
    expect(newCard("card-1", "Title", "d", { priority: "high" }).priority).toBe("high");
  });

  it("parses comma separated labels like the backend stores them", () => {
    expect(parseLabels(" api, ui,,api , ")).toEqual(["api", "ui"]);
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels("x".repeat(40))).toEqual(["x".repeat(30)]);
    expect(parseLabels(Array.from({ length: 15 }, (_, i) => `l${i}`).join(","))).toHaveLength(10);
  });

  it("flags only past due dates as overdue", () => {
    const today = "2026-09-27";
    expect(isOverdue(newCard("c", "t", "", { dueDate: "2026-09-26" }), today)).toBe(true);
    expect(isOverdue(newCard("c", "t", "", { dueDate: "2026-09-27" }), today)).toBe(false);
    expect(isOverdue(newCard("c", "t"), today)).toBe(false);
  });

  it("gives today as a local YYYY-MM-DD date", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("column helpers", () => {
  const board: BoardData = {
    columns: [
      { id: "col-a", title: "A", cardIds: ["card-1"] },
      { id: "col-b", title: "B", cardIds: [] },
    ],
    cards: { "card-1": newCard("card-1", "One") },
  };

  it("adds an empty column at the end", () => {
    const next = addColumn(board, "col-c", "C");
    expect(next.columns.map((column) => column.id)).toEqual(["col-a", "col-b", "col-c"]);
    expect(next.columns[2].cardIds).toEqual([]);
  });

  it("removes only empty columns", () => {
    expect(removeColumn(board, "col-b").columns.map((column) => column.id)).toEqual(["col-a"]);
    expect(removeColumn(board, "col-a").columns).toHaveLength(2);
  });
});
describe("card filters", () => {
  const today = "2026-09-27";
  const card = newCard("card-1", "Write API docs", "Cover the auth routes", {
    priority: "high",
    dueDate: "2026-09-01",
    labels: ["Docs", "backend"],
  });

  it("knows when a filter is active", () => {
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, text: "   " })).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, text: "a" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, priority: "low" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, label: "x" })).toBe(true);
    expect(isFilterActive({ ...EMPTY_FILTER, overdueOnly: true })).toBe(true);
  });

  it("matches text in the title, details or labels, ignoring case", () => {
    expect(matchesFilter(card, { ...EMPTY_FILTER, text: "api" }, today)).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, text: "AUTH" }, today)).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, text: "docs " }, today)).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, text: "frontend" }, today)).toBe(false);
  });

  it("matches priority, exact label and overdue", () => {
    expect(matchesFilter(card, { ...EMPTY_FILTER, priority: "high" }, today)).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, priority: "low" }, today)).toBe(false);
    expect(matchesFilter(card, { ...EMPTY_FILTER, label: "backend" }, today)).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, label: "back" }, today)).toBe(false);
    expect(matchesFilter(card, { ...EMPTY_FILTER, overdueOnly: true }, today)).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, overdueOnly: true }, "2026-08-01")).toBe(false);
  });

  it("requires every criterion to hold", () => {
    expect(
      matchesFilter(
        card,
        { text: "api", priority: "high", label: "Docs", assignee: "", overdueOnly: true },
        today
      )
    ).toBe(true);
    expect(matchesFilter(card, { ...EMPTY_FILTER, text: "api", priority: "low" }, today)).toBe(false);
  });

  it("lists a board's labels once, sorted", () => {
    const board: BoardData = {
      columns: [{ id: "col-a", title: "A", cardIds: ["card-1", "card-2"] }],
      cards: {
        "card-1": newCard("card-1", "One", "", { labels: ["ui", "api"] }),
        "card-2": newCard("card-2", "Two", "", { labels: ["api"] }),
      },
    };
    expect(boardLabels(board)).toEqual(["api", "ui"]);
  });
});
describe("assignee filter, column moves and initials", () => {
  it("filters by assignee", () => {
    const today = "2026-09-27";
    const assigned = newCard("c1", "One", "", { assigneeId: "u1" });
    expect(isFilterActive({ ...EMPTY_FILTER, assignee: "u1" })).toBe(true);
    expect(matchesFilter(assigned, { ...EMPTY_FILTER, assignee: "u1" }, today)).toBe(true);
    expect(matchesFilter(assigned, { ...EMPTY_FILTER, assignee: "u2" }, today)).toBe(false);
    expect(matchesFilter(newCard("c2", "Two"), { ...EMPTY_FILTER, assignee: "u1" }, today)).toBe(false);
  });

  it("swaps a column with its neighbour and ignores moves past the ends", () => {
    const board: BoardData = {
      columns: [
        { id: "a", title: "A", cardIds: [] },
        { id: "b", title: "B", cardIds: [] },
      ],
      cards: {},
    };
    expect(moveColumn(board, "a", 1).columns.map((column) => column.id)).toEqual(["b", "a"]);
    expect(moveColumn(board, "a", -1)).toBe(board);
    expect(moveColumn(board, "b", 1)).toBe(board);
    expect(moveColumn(board, "zzz", 1)).toBe(board);
  });

  it("makes up to two initials", () => {
    expect(initials("Alice Smith")).toBe("AS");
    expect(initials("bob")).toBe("B");
    expect(initials("  Ann  Lee  Moss ")).toBe("AL");
  });
});