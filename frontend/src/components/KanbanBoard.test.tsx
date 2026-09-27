import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import Home from "@/app/page";
import { KanbanBoard } from "@/components/KanbanBoard";

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

describe("Kanban app authentication", () => {
  it("requires sign in before showing the board", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByTestId(/column-/i)).not.toBeInTheDocument();
  });

  it("allows a user to sign in and shows the board", async () => {
    render(<Home />);

    await userEvent.type(screen.getByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByRole("heading", { name: /kanban studio/i })).toBeInTheDocument();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
  });
});

describe("KanbanBoard", () => {
  it("renders five columns", () => {
    render(<KanbanBoard />);
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("renames a column", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    expect(input).toHaveValue("New Name");
  });

  it("adds and removes a card", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await userEvent.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await userEvent.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await userEvent.type(detailsInput, "Notes");

    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(within(column).getByText("New card")).toBeInTheDocument();

    const deleteButton = within(column).getByRole("button", {
      name: /delete new card/i,
    });
    await userEvent.click(deleteButton);

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
  });

  it("persists the board between login and logout", async () => {
    let persistedBoard = {
      columns: [
        { id: "col-backlog", title: "Backlog", cardIds: ["card-1"] },
        { id: "col-discovery", title: "Discovery", cardIds: [] },
        { id: "col-progress", title: "In Progress", cardIds: [] },
        { id: "col-review", title: "Review", cardIds: [] },
        { id: "col-done", title: "Done", cardIds: [] },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Initial task",
          details: "Original details",
        },
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const normalizedUrl = url.includes("/api/board") ? "/api/board" : url;

      if (normalizedUrl === "/api/board" && (!init || init.method === "GET")) {
        return {
          ok: true,
          json: async () => persistedBoard,
        } as Response;
      }

      if (normalizedUrl === "/api/board" && init?.method === "PUT") {
        const nextBoard = JSON.parse(String(init.body));
        persistedBoard = nextBoard;
        return {
          ok: true,
          json: async () => nextBoard,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    global.fetch = fetchMock as typeof fetch;

    const { rerender } = render(<Home />);

    await userEvent.type(screen.getByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    const firstColumn = getFirstColumn();
    const addButton = within(firstColumn).getByRole("button", { name: /add a card/i });
    await userEvent.click(addButton);

    await userEvent.type(within(firstColumn).getByPlaceholderText(/card title/i), "Saved card");
    await userEvent.type(within(firstColumn).getByPlaceholderText(/details/i), "Persisted details");
    await userEvent.click(within(firstColumn).getByRole("button", { name: /add card/i }));

    expect(screen.getByText("Saved card")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /log out/i }));
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();

    rerender(<Home />);
    await userEvent.type(screen.getByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(screen.getByText("Saved card")).toBeInTheDocument();
  });

  it("refreshes the board when the AI signals an update", async () => {
    const initialBoard = {
      columns: [
        { id: "col-backlog", title: "Backlog", cardIds: ["card-1"] },
        { id: "col-discovery", title: "Discovery", cardIds: [] },
        { id: "col-progress", title: "In Progress", cardIds: [] },
        { id: "col-review", title: "Review", cardIds: [] },
        { id: "col-done", title: "Done", cardIds: [] },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Initial task",
          details: "Original details",
        },
      },
    };

    const refreshedBoard = {
      columns: [
        { id: "col-backlog", title: "Backlog", cardIds: [] },
        { id: "col-discovery", title: "Discovery", cardIds: [] },
        { id: "col-progress", title: "In Progress", cardIds: [] },
        { id: "col-review", title: "Review", cardIds: [] },
        { id: "col-done", title: "Done", cardIds: ["card-1"] },
      ],
      cards: {
        "card-1": {
          id: "card-1",
          title: "Refreshed task",
          details: "Updated details",
        },
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const normalizedUrl = url.includes("/api/board") ? "/api/board" : url;

      if (normalizedUrl === "/api/board" && (!init || init.method === "GET")) {
        const nextBoard = fetchMock.mock.calls.filter(
          ([calledUrl, calledInit]) =>
            String(calledUrl).includes("/api/board") && (!calledInit || calledInit.method === "GET")
        ).length === 1
          ? initialBoard
          : refreshedBoard;

        return {
          ok: true,
          json: async () => nextBoard,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    global.fetch = fetchMock as typeof fetch;

    render(<KanbanBoard />);

    expect(await screen.findByText("Initial task")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event("kanban:board-refresh"));
    });

    expect(await screen.findByText("Refreshed task")).toBeInTheDocument();
  });
});
