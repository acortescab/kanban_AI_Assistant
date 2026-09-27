import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { BoardSummary } from "@/lib/api";
import { initialData, newCard, todayIso, type BoardData } from "@/lib/kanban";
import { createFakeServer, failWith, type FakeServer } from "@/test/fakeServer";

const summary: BoardSummary = {
  id: "board-1",
  title: "Project Board",
  description: "",
  cardCount: 8,
  createdAt: "2026-09-01T12:00:00+00:00",
  updatedAt: "2026-09-01T12:00:00+00:00",
  isOwner: true,
  ownerName: "Demo User",
  memberCount: 0,
};

let server: FakeServer;

const renderBoard = (onSummaryChange = vi.fn(), boardSummary = summary, onLeft = vi.fn()) => {
  render(
    <KanbanBoard
      summary={boardSummary}
      currentUserId={server.sessionUserId!}
      onSummaryChange={onSummaryChange}
      onLeft={onLeft}
    />
  );
  return { onSummaryChange, onLeft };
};

const getFirstColumn = async () => (await screen.findAllByTestId(/^column-/))[0];

const addCard = async (column: HTMLElement, title: string, details: string) => {
  await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
  await userEvent.type(within(column).getByPlaceholderText(/card title/i), title);
  if (details) {
    await userEvent.type(within(column).getByPlaceholderText(/details/i), details);
  }
  await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
};

const saved = () => server.boardData("board-1");

beforeEach(() => {
  server = createFakeServer();
});

describe("KanbanBoard", () => {
  it("renders the board's columns from the API", async () => {
    renderBoard();
    expect(await screen.findAllByTestId(/^column-/)).toHaveLength(5);
    expect(screen.getByLabelText("Board title")).toHaveValue("Project Board");
  });

  it("hides and reopens the AI chat without losing the draft", async () => {
    renderBoard();
    await screen.findAllByTestId(/^column-/);
    const toggle = screen.getByRole("button", { name: /ai chat/i });
    await userEvent.type(screen.getByLabelText("Message to AI"), "Keep me");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Message to AI")).not.toBeVisible();

    await userEvent.click(toggle);
    expect(screen.getByLabelText("Message to AI")).toBeVisible();
    expect(screen.getByLabelText("Message to AI")).toHaveValue("Keep me");
  });

  it("renames a column", async () => {
    renderBoard();
    const input = within(await getFirstColumn()).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name{enter}");

    expect(input).toHaveValue("New Name");
    await waitFor(() => expect(saved().columns[0].title).toBe("New Name"));
    expect(server.puts).toHaveLength(1);
  });

  // Regression guard. The column title input is uncontrolled and keyed by the saved title,
  // so a failed save reloads the board and must remount it with the persisted title rather
  // than leaving the rejected text on screen.
  it("restores the saved column title in the input when a rename fails", async () => {
    server.interceptor = (method) =>
      method === "PUT" ? failWith(422, "Save failed") : undefined;
    renderBoard();
    const input = within(await getFirstColumn()).getByLabelText("Column title");

    await userEvent.clear(input);
    await userEvent.type(input, "Broken{enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
    await waitFor(async () =>
      expect(within(await getFirstColumn()).getByLabelText("Column title")).toHaveValue("Backlog")
    );
  });

  it("does not save a column title that is unchanged or empty", async () => {
    renderBoard();
    const input = within(await getFirstColumn()).getByLabelText("Column title");

    await userEvent.click(input);
    await userEvent.tab();
    await userEvent.clear(input);
    await userEvent.tab();

    expect(input).toHaveValue("Backlog");
    expect(server.puts).toHaveLength(0);
  });

  it("adds and removes a card", async () => {
    renderBoard();
    const column = await getFirstColumn();

    await addCard(column, "New card", "Notes");
    expect(within(column).getByText("New card")).toBeInTheDocument();
    await waitFor(() =>
      expect(Object.values(saved().cards).map((card) => card.title)).toContain("New card")
    );

    await userEvent.click(within(column).getByRole("button", { name: /delete new card/i }));
    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(Object.values(saved().cards).map((card) => card.title)).not.toContain("New card")
    );
  });

  it("saves a new card with default fields", async () => {
    renderBoard();
    const column = await getFirstColumn();

    await addCard(column, "No details", "");

    await waitFor(() => expect(server.puts).toHaveLength(1));
    const card = Object.values(saved().cards).find((candidate) => candidate.title === "No details");
    expect(card).toEqual(newCard(card!.id, "No details"));
    expect(card?.id).toMatch(/^card-[0-9a-f-]{36}$/);
  });

  it("edits every card field and saves them", async () => {
    renderBoard();
    const column = await getFirstColumn();

    await userEvent.click(within(column).getByRole("button", { name: /edit align roadmap themes/i }));
    const titleInput = within(column).getByLabelText("Card title");
    const detailsInput = within(column).getByLabelText("Card details");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Edited title");
    await userEvent.clear(detailsInput);
    await userEvent.type(detailsInput, "Edited details");
    await userEvent.selectOptions(within(column).getByLabelText("Card priority"), "high");
    await userEvent.type(within(column).getByLabelText("Card due date"), "2099-01-15");
    await userEvent.type(within(column).getByLabelText("Card labels"), "api, ui, api,  ");
    await userEvent.click(within(column).getByRole("button", { name: /save/i }));

    const card = within(column).getByTestId("card-card-1");
    expect(within(card).getByText("Edited title")).toBeInTheDocument();
    expect(within(card).getByText("Edited details")).toBeInTheDocument();
    expect(within(card).getByText("high")).toBeInTheDocument();
    expect(within(card).getByText("api")).toBeInTheDocument();
    expect(within(card).getByText("ui")).toBeInTheDocument();
    expect(within(card).getByTestId("due-card-1")).toHaveTextContent(/^Due /);
    await waitFor(() =>
      expect(saved().cards["card-1"]).toEqual({
        id: "card-1",
        title: "Edited title",
        details: "Edited details",
        priority: "high",
        dueDate: "2099-01-15",
        labels: ["api", "ui"],
        assigneeId: null,
      })
    );
  });

  it("clears a due date", async () => {
    const data = structuredClone(initialData);
    data.cards["card-1"].dueDate = "2099-01-15";
    server.boards.get("board-1")!.data = data;
    renderBoard();
    const column = await getFirstColumn();

    await userEvent.click(within(column).getByRole("button", { name: /edit align roadmap themes/i }));
    await userEvent.clear(within(column).getByLabelText("Card due date"));
    await userEvent.click(within(column).getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saved().cards["card-1"].dueDate).toBeNull());
    expect(within(column).queryByTestId("due-card-1")).not.toBeInTheDocument();
  });

  it("discards card edits on cancel and ignores an empty title", async () => {
    renderBoard();
    const column = await getFirstColumn();

    await userEvent.click(within(column).getByRole("button", { name: /edit align roadmap themes/i }));
    await userEvent.clear(within(column).getByLabelText("Card title"));
    await userEvent.click(within(column).getByRole("button", { name: /save/i }));
    expect(within(column).getByLabelText("Card title")).toBeInTheDocument();

    await userEvent.type(within(column).getByLabelText("Card title"), "Not saved");
    await userEvent.click(within(column).getByRole("button", { name: /cancel/i }));

    expect(within(column).getByText("Align roadmap themes")).toBeInTheDocument();
    expect(within(column).queryByText("Not saved")).not.toBeInTheDocument();
    expect(server.puts).toHaveLength(0);
  });

  it("shows overdue cards and board stats", async () => {
    const data = structuredClone(initialData);
    data.cards["card-1"] = { ...data.cards["card-1"], dueDate: "2000-01-01", priority: "high" };
    data.cards["card-2"] = { ...data.cards["card-2"], dueDate: todayIso() };
    server.boards.get("board-1")!.data = data;
    renderBoard();

    expect(await screen.findByTestId("due-card-1")).toHaveTextContent(/^Overdue /);
    expect(screen.getByTestId("due-card-2")).toHaveTextContent(/^Due /);
    const stats = screen.getByTestId("board-stats");
    expect(within(stats).getByText("Cards").nextSibling).toHaveTextContent("8");
    expect(within(stats).getByText("High priority").nextSibling).toHaveTextContent("1");
    expect(within(stats).getByText("Overdue").nextSibling).toHaveTextContent("1");
  });

  it("adds a column and deletes it again", async () => {
    renderBoard();
    await screen.findAllByTestId(/^column-/);

    await userEvent.click(screen.getByRole("button", { name: "Add column" }));

    const columns = screen.getAllByTestId(/^column-/);
    expect(columns).toHaveLength(6);
    expect(within(columns[5]).getByLabelText("Column title")).toHaveValue("New column");
    await waitFor(() => expect(saved().columns).toHaveLength(6));

    await userEvent.click(within(columns[5]).getByRole("button", { name: /delete column new column/i }));
    expect(screen.getAllByTestId(/^column-/)).toHaveLength(5);
    await waitFor(() => expect(saved().columns).toHaveLength(5));
  });

  it("only allows deleting empty columns", async () => {
    renderBoard();
    const first = await getFirstColumn();

    expect(within(first).getByRole("button", { name: /delete column backlog/i })).toBeDisabled();
  });

  it("keeps at least one column", async () => {
    server.boards.get("board-1")!.data = {
      columns: [{ id: "col-only", title: "Only", cardIds: [] }],
      cards: {},
    };
    renderBoard();

    const only = await getFirstColumn();
    expect(within(only).getByRole("button", { name: /delete column only/i })).toBeDisabled();
  });

  it("hides the add column button at the column limit", async () => {
    server.boards.get("board-1")!.data = {
      columns: Array.from({ length: 12 }, (_, index) => ({
        id: `col-${index}`,
        title: `C${index}`,
        cardIds: [],
      })),
      cards: {},
    };
    renderBoard();

    expect(await screen.findAllByTestId(/^column-/)).toHaveLength(12);
    expect(screen.queryByRole("button", { name: "Add column" })).not.toBeInTheDocument();
  });

  it("renames the board and edits its description", async () => {
    const { onSummaryChange } = renderBoard();
    const title = await screen.findByLabelText("Board title");

    await userEvent.clear(title);
    await userEvent.type(title, "Launch plan{enter}");
    await waitFor(() =>
      expect(onSummaryChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Launch plan" }))
    );

    await userEvent.type(screen.getByLabelText("Board description"), "Ship it{enter}");
    await waitFor(() =>
      expect(onSummaryChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ description: "Ship it" })
      )
    );
    expect(server.boards.get("board-1")!.summary).toMatchObject({
      title: "Launch plan",
      description: "Ship it",
    });
  });

  it("does not save an empty board title", async () => {
    const { onSummaryChange } = renderBoard();
    const title = await screen.findByLabelText("Board title");

    await userEvent.clear(title);
    await userEvent.tab();

    expect(title).toHaveValue("Project Board");
    expect(onSummaryChange).not.toHaveBeenCalled();
  });

  it("shows the server's reason when a board rename fails", async () => {
    server.interceptor = (method) =>
      method === "PATCH" ? failWith(422, "Title is too long") : undefined;
    renderBoard();
    const title = await screen.findByLabelText("Board title");

    await userEvent.type(title, "!{enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Title is too long");
  });

  describe("filtering", () => {
    beforeEach(() => {
      const data = structuredClone(initialData);
      data.cards["card-1"] = { ...data.cards["card-1"], priority: "high", labels: ["roadmap"] };
      data.cards["card-4"] = { ...data.cards["card-4"], labels: ["copy"], dueDate: "2000-01-01" };
      server.boards.get("board-1")!.data = data;
    });

    const visibleCardIds = () =>
      screen.getAllByTestId(/^card-card-/).map((card) => card.dataset.testid);

    it("searches card text and shows how many match", async () => {
      renderBoard();
      await screen.findAllByTestId(/^column-/);
      expect(screen.queryByTestId("filter-count")).not.toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("Search cards"), "customer");

      expect(visibleCardIds()).toEqual(["card-card-2"]);
      expect(screen.getByTestId("filter-count")).toHaveTextContent("Showing 1 of 8 cards");
      expect(within(screen.getByTestId("column-col-done")).getByText("No matching cards")).toBeInTheDocument();
    });

    it("filters by priority, label and overdue, then clears", async () => {
      renderBoard();
      await screen.findAllByTestId(/^column-/);

      await userEvent.selectOptions(screen.getByLabelText("Filter by priority"), "high");
      expect(visibleCardIds()).toEqual(["card-card-1"]);

      await userEvent.selectOptions(screen.getByLabelText("Filter by priority"), "all");
      expect(
        within(screen.getByLabelText("Filter by label")).getAllByRole("option").map((o) => o.textContent)
      ).toEqual(["Any label", "copy", "roadmap"]);
      await userEvent.selectOptions(screen.getByLabelText("Filter by label"), "copy");
      expect(visibleCardIds()).toEqual(["card-card-4"]);

      await userEvent.selectOptions(screen.getByLabelText("Filter by label"), "");
      await userEvent.click(screen.getByRole("button", { name: "Overdue only" }));
      expect(screen.getByRole("button", { name: "Overdue only" })).toHaveAttribute("aria-pressed", "true");
      expect(visibleCardIds()).toEqual(["card-card-4"]);

      await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
      expect(visibleCardIds()).toHaveLength(8);
      expect(screen.getByLabelText("Search cards")).toHaveValue("");
    });

    it("hides the label filter when no card has a label", async () => {
      server.boards.get("board-1")!.data = structuredClone(initialData);
      renderBoard();
      await screen.findAllByTestId(/^column-/);

      expect(screen.queryByLabelText("Filter by label")).not.toBeInTheDocument();
    });

    it("drops a label filter once no card carries the label", async () => {
      renderBoard();
      await screen.findAllByTestId(/^column-/);
      await userEvent.selectOptions(screen.getByLabelText("Filter by label"), "copy");
      const card = screen.getByTestId("card-card-4");

      await userEvent.click(within(card).getByRole("button", { name: /edit/i }));
      await userEvent.clear(within(card).getByLabelText("Card labels"));
      await userEvent.click(within(card).getByRole("button", { name: /save/i }));

      expect(visibleCardIds()).toHaveLength(8);
      expect(screen.queryByTestId("filter-count")).not.toBeInTheDocument();
    });

    it("keeps filtering while cards are edited and saves the full board", async () => {
      renderBoard();
      await screen.findAllByTestId(/^column-/);
      await userEvent.type(screen.getByLabelText("Search cards"), "roadmap");

      const card = screen.getByTestId("card-card-1");
      await userEvent.click(within(card).getByRole("button", { name: /delete/i }));

      await waitFor(() => expect(Object.keys(saved().cards)).toHaveLength(7));
      expect(screen.getByTestId("filter-count")).toHaveTextContent("Showing 0 of 7 cards");
    });
  });

  it("gives each card a drag handle button instead of making the card a button", async () => {
    renderBoard();
    const card = within(await getFirstColumn()).getByTestId("card-card-1");

    expect(within(card).getByRole("button", { name: /move align roadmap themes/i })).toBeInTheDocument();
    expect(card).not.toHaveAttribute("role", "button");
  });

  it("shows an error and no board when loading fails, without saving anything", async () => {
    server.interceptor = () => failWith(500, "boom");

    renderBoard();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the board/i);
    expect(screen.queryByTestId(/^column-/)).not.toBeInTheDocument();
    // Only the two reads (board data and members), never a save.
    expect(server.fetch.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "GET"]);
  });

  it("reloads the saved board when a save fails", async () => {
    let failNextPut = true;
    server.interceptor = (method) => {
      if (method === "PUT" && failNextPut) {
        failNextPut = false;
        return failWith(500, "Save failed");
      }
      return undefined;
    };
    renderBoard();
    const column = await getFirstColumn();
    await addCard(column, "Never saved", "Details");

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save your last change/i);
    expect(screen.queryByText("Never saved")).not.toBeInTheDocument();
    expect(saved().cards["card-1"]).toBeDefined();
  });

  it("shows the board returned by the AI", async () => {
    const aiBoard: BoardData = {
      ...initialData,
      cards: { ...initialData.cards, "card-1": newCard("card-1", "Changed by AI", "Updated details") },
    };
    server.chatReply = { response: "Done.", board: aiBoard };
    renderBoard();
    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message to AI"), "Rename card-1");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(await screen.findByText("Changed by AI")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    expect(server.chatRequests[0].boardId).toBe("board-1");
  });

  it("waits for pending saves before asking the AI", async () => {
    const events: string[] = [];
    let finishSave = () => {};
    server.chatReply = { response: "Done.", board: null };
    server.interceptor = async (method, path) => {
      if (path.endsWith("/ai/chat")) {
        events.push("ai");
      }
      if (method === "PUT") {
        events.push("save started");
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
        events.push("save finished");
      }
      return undefined;
    };
    renderBoard();

    await addCard(await getFirstColumn(), "Latest card", "Details");
    await userEvent.type(screen.getByLabelText("Message to AI"), "Summarize");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(events).toEqual(["save started"]);

    await act(async () => finishSave());

    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(events).toEqual(["save started", "save finished", "ai"]);
  });

  it("keeps an edit made while the AI was working and refuses the AI's stale change", async () => {
    const aiBoard: BoardData = {
      ...initialData,
      cards: { ...initialData.cards, "card-1": newCard("card-1", "Changed by AI") },
    };
    server.chatReply = { response: "Done.", board: aiBoard };
    let releaseAi = () => {};
    server.interceptor = async (_method, path) => {
      if (path.endsWith("/ai/chat")) {
        await new Promise<void>((resolve) => {
          releaseAi = resolve;
        });
      }
      return undefined;
    };

    renderBoard();
    const column = await getFirstColumn();
    await userEvent.type(screen.getByLabelText("Message to AI"), "Summarize");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));

    // The AI request is in flight, so this edit is saved first and moves the version on.
    await addCard(column, "Edited during the request", "Details");
    await waitFor(() => expect(server.puts).toHaveLength(1));

    await act(async () => releaseAi());

    expect(await screen.findByText(/changed while the assistant was working/i)).toBeInTheDocument();
    expect(screen.getByText("Edited during the request")).toBeInTheDocument();
    expect(screen.queryByText("Changed by AI")).not.toBeInTheDocument();
    expect(saved().cards["card-1"].title).toBe("Align roadmap themes");
  });

  it("applies the AI's saved board without saving it again, then saves on top of it", async () => {
    const aiBoard: BoardData = {
      ...initialData,
      cards: { ...initialData.cards, "card-1": newCard("card-1", "Changed by AI") },
    };
    server.chatReply = { response: "Done.", board: aiBoard };
    renderBoard();
    await screen.findAllByTestId(/^column-/);

    await userEvent.type(screen.getByLabelText("Message to AI"), "Rename");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(await screen.findByText("Changed by AI")).toBeInTheDocument();
    expect(server.puts).toHaveLength(0);

    // The next edit is based on the version the AI produced, so it is accepted.
    await addCard(await getFirstColumn(), "After the AI", "");
    await waitFor(() => expect(server.puts).toHaveLength(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(saved().cards["card-1"].title).toBe("Changed by AI");
  });

  describe("versioned saves", () => {
    it("bases each save on the version the previous one produced", async () => {
      renderBoard();
      const column = await getFirstColumn();

      await addCard(column, "First", "");
      await addCard(column, "Second", "");

      await waitFor(() => expect(server.puts).toHaveLength(2));
      const ifMatches = server.fetch.mock.calls
        .filter(([, init]) => init?.method === "PUT")
        .map(([, init]) => (init?.headers as Record<string, string>)["If-Match"]);
      expect(ifMatches).toEqual(['"0"', '"1"']);
    });

    it("shows someone else's change instead of overwriting it", async () => {
      renderBoard();
      const column = await getFirstColumn();
      server.editElsewhere("board-1", (data) => {
        data.columns[1].title = "Renamed by a teammate";
      });

      await addCard(column, "My stale change", "");

      expect(await screen.findByRole("alert")).toHaveTextContent(/someone else changed this board/i);
      expect(screen.queryByText("My stale change")).not.toBeInTheDocument();
      expect(screen.getAllByLabelText("Column title")[1]).toHaveValue("Renamed by a teammate");
      expect(server.puts).toHaveLength(0);

      // After the reload, edits are based on the teammate's version and save normally.
      await addCard(await getFirstColumn(), "Retried", "");
      await waitFor(() => expect(server.puts).toHaveLength(1));
    });

    it("drops edits queued behind a refused save", async () => {
      let releaseFirst = () => {};
      let held = false;
      server.interceptor = async (method) => {
        if (method === "PUT" && !held) {
          held = true;
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return failWith(409, "This board was changed by someone else.");
        }
        return undefined;
      };
      renderBoard();
      const column = await getFirstColumn();

      await addCard(column, "Refused", "");
      await addCard(column, "Queued behind it", "");
      await act(async () => releaseFirst());

      expect(await screen.findByRole("alert")).toHaveTextContent(/someone else changed/i);
      expect(server.puts).toHaveLength(0);
      expect(screen.queryByText("Queued behind it")).not.toBeInTheDocument();
    });
  });

  describe("assignees", () => {
    let aliceId: string;

    beforeEach(() => {
      const alice = server.addUser("alice");
      alice.displayName = "Alice Smith";
      aliceId = alice.id;
      server.boards.get("board-1")!.memberIds.push(aliceId);
    });

    it("assigns a card to a member and shows their initials", async () => {
      renderBoard();
      const card = await screen.findByTestId("card-card-1");

      await userEvent.click(within(card).getByRole("button", { name: /edit/i }));
      expect(
        within(card).getAllByRole("option").filter((o) => o.closest("select")?.getAttribute("aria-label") === "Card assignee").map((o) => o.textContent)
      ).toEqual(["Unassigned", "Demo User", "Alice Smith"]);
      await userEvent.selectOptions(within(card).getByLabelText("Card assignee"), aliceId);
      await userEvent.click(within(card).getByRole("button", { name: /save/i }));

      expect(within(card).getByTestId("assignee-card-1")).toHaveTextContent("AS");
      expect(within(card).getByLabelText("Assigned to Alice Smith")).toBeInTheDocument();
      await waitFor(() => expect(saved().cards["card-1"].assigneeId).toBe(aliceId));
    });

    it("filters cards assigned to me", async () => {
      const data = structuredClone(initialData);
      data.cards["card-3"].assigneeId = "user-1";
      data.cards["card-5"].assigneeId = aliceId;
      server.boards.get("board-1")!.data = data;
      renderBoard();
      await screen.findAllByTestId(/^column-/);

      await userEvent.selectOptions(screen.getByLabelText("Filter by assignee"), "user-1");
      expect(screen.getAllByTestId(/^card-card-/).map((c) => c.dataset.testid)).toEqual(["card-card-3"]);
      expect(
        within(screen.getByLabelText("Filter by assignee")).getByRole("option", { name: "Assigned to me" })
      ).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText("Filter by assignee"), aliceId);
      expect(screen.getAllByTestId(/^card-card-/).map((c) => c.dataset.testid)).toEqual(["card-card-5"]);
    });

    it("reloads the board after removing a member, so their cards show as unassigned", async () => {
      const data = structuredClone(initialData);
      data.cards["card-1"].assigneeId = aliceId;
      server.boards.get("board-1")!.data = data;
      renderBoard();
      expect(await screen.findByTestId("assignee-card-1")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /members/i }));
      await userEvent.click(await screen.findByRole("button", { name: "Remove alice" }));

      await waitFor(() => expect(screen.queryByTestId("assignee-card-1")).not.toBeInTheDocument());
      // The reload picked up the new version, so the next edit saves without a conflict.
      await addCard(await getFirstColumn(), "After removal", "");
      await waitFor(() => expect(server.puts).toHaveLength(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("column order", () => {
    it("moves a column left and right and saves the order", async () => {
      renderBoard();
      await screen.findAllByTestId(/^column-/);
      const titles = () => screen.getAllByLabelText("Column title").map((input) => (input as HTMLInputElement).value);

      await userEvent.click(screen.getByRole("button", { name: "Move column Review right" }));
      expect(titles()).toEqual(["Backlog", "Discovery", "In Progress", "Done", "Review"]);
      await userEvent.click(screen.getByRole("button", { name: "Move column Backlog left" }));
      expect(titles()).toEqual(["Backlog", "Discovery", "In Progress", "Done", "Review"]);
      await userEvent.click(screen.getByRole("button", { name: "Move column Discovery left" }));
      expect(titles()).toEqual(["Discovery", "Backlog", "In Progress", "Done", "Review"]);

      await waitFor(() => expect(saved().columns.map((column) => column.title)).toEqual(titles()));
    });

    it("disables moving past either end", async () => {
      renderBoard();
      await screen.findAllByTestId(/^column-/);

      expect(screen.getByRole("button", { name: "Move column Backlog left" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move column Done right" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move column Backlog right" })).toBeEnabled();
    });
  });

  describe("activity", () => {
    it("shows the feed and refreshes it after a save", async () => {
      server.boards.get("board-1")!.activity = [
        { id: 1, actor: "Demo User", message: "created the board", createdAt: "2026-09-01T12:00:00+00:00" },
      ];
      renderBoard();
      await screen.findAllByTestId(/^column-/);

      await userEvent.click(screen.getByRole("button", { name: "Activity" }));
      const feed = await screen.findByTestId("board-activity");
      expect(await within(feed).findByText("created the board")).toBeInTheDocument();
      expect(within(feed).getByText("Demo User")).toBeInTheDocument();

      server.boards.get("board-1")!.activity.unshift({
        id: 2,
        actor: "Demo User",
        message: 'added "Fresh" to Backlog',
        createdAt: "2026-09-01T12:05:00+00:00",
      });
      await addCard(await getFirstColumn(), "Fresh", "");

      expect(await within(feed).findByText('added "Fresh" to Backlog')).toBeInTheDocument();
    });

    it("says when there is no activity and when it cannot load", async () => {
      renderBoard();
      await screen.findAllByTestId(/^column-/);
      await userEvent.click(screen.getByRole("button", { name: "Activity" }));
      expect(await screen.findByText("No activity yet.")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Activity" }));
      server.interceptor = (_method, path) =>
        path.endsWith("/activity") ? failWith(500, "boom") : undefined;
      await userEvent.click(screen.getByRole("button", { name: "Activity" }));
      expect(await screen.findByText("Could not load the activity.")).toBeInTheDocument();
    });
  });

  describe("members", () => {
    beforeEach(() => {
      server.addUser("alice");
    });

    it("lets the owner share the board and remove a member", async () => {
      const { onSummaryChange } = renderBoard();
      await screen.findAllByTestId(/^column-/);
      expect(screen.getByTestId("member-count")).toHaveTextContent("1");

      await userEvent.click(screen.getByRole("button", { name: /members/i }));
      const panel = await screen.findByTestId("board-members");
      await userEvent.type(within(panel).getByLabelText("Add member by username"), "alice");
      await userEvent.click(within(panel).getByRole("button", { name: "Share" }));

      expect(await within(panel).findByText("alice")).toBeInTheDocument();
      expect(onSummaryChange).toHaveBeenLastCalledWith(expect.objectContaining({ memberCount: 1 }));
      expect(within(panel).getByLabelText("Add member by username")).toHaveValue("");

      await userEvent.click(within(panel).getByRole("button", { name: "Remove alice" }));
      await waitFor(() => expect(within(panel).queryByText("alice")).not.toBeInTheDocument());
      expect(onSummaryChange).toHaveBeenLastCalledWith(expect.objectContaining({ memberCount: 0 }));
    });

    it("shows why a user could not be added", async () => {
      renderBoard();
      await screen.findAllByTestId(/^column-/);
      await userEvent.click(screen.getByRole("button", { name: /members/i }));
      const panel = await screen.findByTestId("board-members");

      await userEvent.type(within(panel).getByLabelText("Add member by username"), "nobody");
      await userEvent.click(within(panel).getByRole("button", { name: "Share" }));

      expect(await within(panel).findByRole("alert")).toHaveTextContent('No user named "nobody".');
    });

    it("shows a member who shared the board and lets them leave", async () => {
      const alice = server.accounts.get("alice")!.user;
      server.boards.get("board-1")!.memberIds.push(alice.id);
      server.sessionUserId = alice.id;
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const { onLeft } = renderBoard(vi.fn(), {
        ...summary,
        isOwner: false,
        memberCount: 1,
      });
      expect(await screen.findByTestId("shared-by")).toHaveTextContent(
        "Shared with you by Demo User"
      );

      await userEvent.click(screen.getByRole("button", { name: /members/i }));
      const panel = await screen.findByTestId("board-members");
      expect(within(panel).queryByLabelText("Add member by username")).not.toBeInTheDocument();
      await userEvent.click(await within(panel).findByRole("button", { name: "Leave board" }));

      await waitFor(() => expect(onLeft).toHaveBeenCalled());
      expect(server.boards.get("board-1")!.memberIds).toEqual([]);
      vi.restoreAllMocks();
    });
  });
});
