import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AiChatSidebar, MAX_SENT_HISTORY } from "@/components/AiChatSidebar";
import { createFakeServer, DEMO_BOARD, failWith, type FakeServer } from "@/test/fakeServer";

let server: FakeServer;

beforeEach(() => {
  server = createFakeServer();
});

const renderSidebar = () => {
  const onBoardUpdate = vi.fn();
  render(
    <AiChatSidebar
      boardId="board-1"
      waitForSaves={() => Promise.resolve()}
      onBoardUpdate={onBoardUpdate}
    />
  );
  return { onBoardUpdate };
};

const sendMessage = async (text: string) => {
  await userEvent.type(screen.getByPlaceholderText(/ask me to move a card or explain the board/i), text);
  await userEvent.click(screen.getByRole("button", { name: /send message/i }));
};

describe("AiChatSidebar", () => {
  it("sends the question with history to the board's route and applies the returned board", async () => {
    server.chatReply = { response: "I moved the card.", board: DEMO_BOARD };
    const { onBoardUpdate } = renderSidebar();

    expect(screen.getByText(/ask me to summarize the board/i)).toBeInTheDocument();

    await sendMessage("Move card-1 to Done");

    expect(screen.getByText("Move card-1 to Done")).toBeInTheDocument();
    expect(await screen.findByText("I moved the card.")).toBeInTheDocument();
    // The version is the one the server saved the AI's board at (from the ETag).
    expect(onBoardUpdate).toHaveBeenCalledWith(DEMO_BOARD, 1);
    expect(server.chatRequests).toEqual([
      {
        boardId: "board-1",
        question: "Move card-1 to Done",
        history: [
          {
            role: "assistant",
            content: "Ask me to summarize the board, rename columns, or move cards for you.",
          },
        ],
      },
    ]);
  });

  it("does not update the board when the AI makes no change", async () => {
    server.chatReply = { response: "There are 2 cards.", board: null };
    const { onBoardUpdate } = renderSidebar();

    await sendMessage("How many cards?");

    expect(await screen.findByText("There are 2 cards.")).toBeInTheDocument();
    expect(onBoardUpdate).not.toHaveBeenCalled();
  });

  it("shows the backend error detail when the AI request fails", async () => {
    server.interceptor = () =>
      failWith(503, "OpenRouter is rate limited right now. Please try again in a moment.");
    renderSidebar();

    await sendMessage("Move card-1 to Done");

    expect(await screen.findByText(/rate limited right now/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send message/i })).toBeEnabled();
  });

  it("ignores an empty message", async () => {
    renderSidebar();

    await userEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(server.chatRequests).toHaveLength(0);
  });

  it("caps the history it sends in a long conversation", async () => {
    renderSidebar();

    for (let turn = 0; turn < 12; turn += 1) {
      await sendMessage(`Question ${turn}`);
      await waitFor(() => expect(screen.getAllByText("OK")).toHaveLength(turn + 1));
    }

    const last = server.chatRequests.at(-1)!;
    expect(last.history).toHaveLength(MAX_SENT_HISTORY);
    expect(last.history.at(-1)).toEqual({ role: "assistant", content: "OK" });
  });
});
