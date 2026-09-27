import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AiChatSidebar } from "@/components/AiChatSidebar";

describe("AiChatSidebar", () => {
  it("shows conversation history and sends the current board context to the AI", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    const board = {
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
          title: "Move me",
          details: "Initial details",
        },
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/board")) {
        return {
          ok: true,
          json: async () => board,
        } as Response;
      }

      if (url.includes("/api/ai/chat")) {
        return {
          ok: true,
          json: async () => ({
            response: "I moved the card.",
            board,
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    global.fetch = fetchMock as typeof fetch;

    render(<AiChatSidebar />);

    expect(
      screen.getByText(/ask me to summarize the board/i)
    ).toBeInTheDocument();

    await userEvent.type(
      screen.getByPlaceholderText(/ask me to move a card or explain the board/i),
      "Move card-1 to Done"
    );
    await userEvent.click(
      screen.getByRole("button", { name: /send message/i })
    );

    expect(screen.getByText("Move card-1 to Done")).toBeInTheDocument();
    expect(screen.getByText("I moved the card.")).toBeInTheDocument();
    expect(dispatchSpy).toHaveBeenCalledWith(expect.any(Event));

    const aiRequest = fetchMock.mock.calls.find(
      ([input]) => String(input).includes("/api/ai/chat")
    );

    expect(aiRequest).toBeDefined();
    const requestBody = JSON.parse(String(aiRequest?.[1]?.body ?? "{}"));
    expect(requestBody.question).toBe("Move card-1 to Done");
    expect(requestBody.history).toHaveLength(1);
    expect(requestBody.board.columns[0].title).toBe("Backlog");

    dispatchSpy.mockRestore();
  });

  it("shows the backend error detail when the AI request fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/board")) {
        return {
          ok: true,
          json: async () => ({
            columns: [],
            cards: {},
          }),
        } as Response;
      }

      return {
        ok: false,
        json: async () => ({
          detail: "OpenRouter is rate limited right now. Please try again in a moment.",
        }),
      } as Response;
    });

    global.fetch = fetchMock as typeof fetch;

    render(<AiChatSidebar />);

    await userEvent.type(
      screen.getByPlaceholderText(/ask me to move a card or explain the board/i),
      "Move card-1 to Done"
    );
    await userEvent.click(
      screen.getByRole("button", { name: /send message/i })
    );

    expect(
      await screen.findByText(/rate limited right now/i)
    ).toBeInTheDocument();
  });
});