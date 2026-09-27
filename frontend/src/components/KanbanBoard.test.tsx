import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import Home from "@/app/page";
import { KanbanBoard } from "@/components/KanbanBoard";
import { initialData, type BoardData } from "@/lib/kanban";

const getFirstColumn = async () => (await screen.findAllByTestId(/column-/i))[0];

const jsonResponse = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as Response;

// Serves GET/PUT /api/board from an in-memory board and records every PUT.
const mockBoardApi = (board: BoardData = initialData, { failPut = false } = {}) => {
  const api = { board, puts: [] as BoardData[], fetch: undefined as unknown as typeof fetch };
  api.fetch = vi.fn<typeof fetch>(async (_input, init) => {
    if (init?.method === "PUT") {
      const nextBoard = JSON.parse(String(init.body)) as BoardData;
      api.puts.push(nextBoard);
      if (failPut) {
        return jsonResponse({ detail: "Save failed" }, false);
      }
      api.board = nextBoard;
      return jsonResponse(nextBoard);
    }
    return jsonResponse(api.board);
  });
  global.fetch = api.fetch;
  return api;
};

const signIn = async () => {
  await userEvent.type(screen.getByLabelText("Username"), "user");
  await userEvent.type(screen.getByLabelText("Password"), "password");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
};

const addCard = async (column: HTMLElement, title: string, details: string) => {
  await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
  await userEvent.type(within(column).getByPlaceholderText(/card title/i), title);
  await userEvent.type(within(column).getByPlaceholderText(/details/i), details);
  await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
};

beforeEach(() => {
  mockBoardApi();
});

describe("Kanban app authentication", () => {
  it("requires sign in before showing the board", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByTestId(/column-/i)).not.toBeInTheDocument();
  });

  it("rejects invalid credentials", async () => {
    render(<Home />);

    await userEvent.type(screen.getByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Invalid username or password.");
    expect(screen.queryByTestId(/column-/i)).not.toBeInTheDocument();
  });

  it("allows a user to sign in and shows the board", async () => {
    render(<Home />);
    await signIn();

    expect(screen.getByRole("heading", { name: /kanban studio/i })).toBeInTheDocument();
    expect(await screen.findAllByTestId(/column-/i)).toHaveLength(5);
  });
});

describe("KanbanBoard", () => {
  it("renders five columns from the API", async () => {
    render(<KanbanBoard />);
    expect(await screen.findAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("renames a column", async () => {
    const api = mockBoardApi();
    render(<KanbanBoard />);
    const input = within(await getFirstColumn()).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name{enter}");

    expect(input).toHaveValue("New Name");
    expect(api.board.columns[0].title).toBe("New Name");
    expect(api.puts).toHaveLength(1);
  });

  it("does not save a column title that is unchanged or empty", async () => {
    const api = mockBoardApi();
    render(<KanbanBoard />);
    const input = within(await getFirstColumn()).getByLabelText("Column title");

    await userEvent.click(input);
    await userEvent.tab();
    await userEvent.clear(input);
    await userEvent.tab();

    expect(input).toHaveValue("Backlog");
    expect(api.puts).toHaveLength(0);
  });

  it("adds and removes a card", async () => {
    const api = mockBoardApi();
    render(<KanbanBoard />);
    const column = await getFirstColumn();

    await addCard(column, "New card", "Notes");
    expect(within(column).getByText("New card")).toBeInTheDocument();
    expect(Object.values(api.board.cards).map((card) => card.title)).toContain("New card");

    await userEvent.click(within(column).getByRole("button", { name: /delete new card/i }));
    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
    expect(Object.values(api.board.cards).map((card) => card.title)).not.toContain("New card");
  });

  it("saves a card added without details with empty details", async () => {
    const api = mockBoardApi();
    render(<KanbanBoard />);
    const column = await getFirstColumn();

    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "No details");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    const saved = Object.values(api.board.cards).find((card) => card.title === "No details");
    expect(saved?.details).toBe("");
    expect(saved?.id).toMatch(/^card-[0-9a-f-]{36}$/);
  });

  it("edits a card's title and details and saves them", async () => {
    const api = mockBoardApi();
    render(<KanbanBoard />);
    const column = await getFirstColumn();

    await userEvent.click(within(column).getByRole("button", { name: /edit align roadmap themes/i }));
    const titleInput = within(column).getByLabelText("Card title");
    const detailsInput = within(column).getByLabelText("Card details");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Edited title");
    await userEvent.clear(detailsInput);
    await userEvent.type(detailsInput, "Edited details");
    await userEvent.click(within(column).getByRole("button", { name: /save/i }));

    expect(within(column).getByText("Edited title")).toBeInTheDocument();
    expect(within(column).getByText("Edited details")).toBeInTheDocument();
    expect(api.board.cards["card-1"]).toEqual({
      id: "card-1",
      title: "Edited title",
      details: "Edited details",
    });
  });

  it("discards card edits on cancel and ignores an empty title", async () => {
    const api = mockBoardApi();
    render(<KanbanBoard />);
    const column = await getFirstColumn();

    await userEvent.click(within(column).getByRole("button", { name: /edit align roadmap themes/i }));
    await userEvent.clear(within(column).getByLabelText("Card title"));
    await userEvent.click(within(column).getByRole("button", { name: /save/i }));
    expect(within(column).getByLabelText("Card title")).toBeInTheDocument();

    await userEvent.type(within(column).getByLabelText("Card title"), "Not saved");
    await userEvent.click(within(column).getByRole("button", { name: /cancel/i }));

    expect(within(column).getByText("Align roadmap themes")).toBeInTheDocument();
    expect(within(column).queryByText("Not saved")).not.toBeInTheDocument();
    expect(api.puts).toHaveLength(0);
  });

  it("shows an error and no board when loading fails, without saving anything", async () => {
    global.fetch = vi.fn(async () => jsonResponse({}, false)) as typeof fetch;

    render(<KanbanBoard />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the board/i);
    expect(screen.queryByTestId(/column-/i)).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows an error when a save fails", async () => {
    mockBoardApi(initialData, { failPut: true });
    render(<KanbanBoard />);

    await addCard(await getFirstColumn(), "Unsaved card", "Details");

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not save/i);
  });

  it("persists the board between login and logout", async () => {
    const api = mockBoardApi();
    const { rerender } = render(<Home />);
    await signIn();

    await addCard(await getFirstColumn(), "Saved card", "Persisted details");
    expect(screen.getByText("Saved card")).toBeInTheDocument();
    expect(api.puts).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /log out/i }));
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();

    rerender(<Home />);
    await signIn();

    expect(await screen.findByText("Saved card")).toBeInTheDocument();
  });

  it("shows the board returned by the AI", async () => {
    const aiBoard: BoardData = {
      ...initialData,
      cards: {
        ...initialData.cards,
        "card-1": { id: "card-1", title: "Changed by AI", details: "Updated details" },
      },
    };
    const boardFetch = mockBoardApi().fetch;
    global.fetch = vi.fn<typeof fetch>(async (input, init) =>
      String(input) === "/api/ai/chat"
        ? jsonResponse({ response: "Done.", board: aiBoard })
        : boardFetch(input, init)
    );
    render(<KanbanBoard />);
    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Message to AI"), "Rename card-1");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(await screen.findByText("Changed by AI")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
  });

  it("waits for pending saves before asking the AI", async () => {
    const events: string[] = [];
    let finishSave = () => {};
    const api = mockBoardApi();
    const boardFetch = api.fetch;
    global.fetch = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "/api/ai/chat") {
        events.push("ai");
        return jsonResponse({ response: "Done.", board: null });
      }
      if (init?.method === "PUT") {
        events.push("save started");
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
        events.push("save finished");
      }
      return boardFetch(input, init);
    });
    render(<KanbanBoard />);

    await addCard(await getFirstColumn(), "Latest card", "Details");
    await userEvent.type(screen.getByLabelText("Message to AI"), "Summarize");
    await userEvent.click(screen.getByRole("button", { name: /send message/i }));
    expect(events).toEqual(["save started"]);

    await act(async () => finishSave());

    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(events).toEqual(["save started", "save finished", "ai"]);
  });
});
