import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AiChatSidebar } from "@/components/AiChatSidebar";
import { initialData } from "@/lib/kanban";

const renderSidebar = () => {
  const onBoardUpdate = vi.fn();
  render(
    <AiChatSidebar waitForSaves={() => Promise.resolve()} onBoardUpdate={onBoardUpdate} />
  );
  return { onBoardUpdate };
};

const sendMessage = async (text: string) => {
  await userEvent.type(
    screen.getByPlaceholderText(/ask me to move a card or explain the board/i),
    text
  );
  await userEvent.click(screen.getByRole("button", { name: /send message/i }));
};

describe("AiChatSidebar", () => {
  it("sends the question with history and applies the returned board", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      ({
        ok: true,
        json: async () => ({ response: "I moved the card.", board: initialData }),
      }) as Response
    );
    global.fetch = fetchMock;
    const { onBoardUpdate } = renderSidebar();

    expect(screen.getByText(/ask me to summarize the board/i)).toBeInTheDocument();

    await sendMessage("Move card-1 to Done");

    expect(screen.getByText("Move card-1 to Done")).toBeInTheDocument();
    expect(await screen.findByText("I moved the card.")).toBeInTheDocument();
    expect(onBoardUpdate).toHaveBeenCalledWith(initialData);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai/chat");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      question: "Move card-1 to Done",
      history: [
        {
          role: "assistant",
          content: "Ask me to summarize the board, rename columns, or move cards for you.",
        },
      ],
    });
  });

  it("does not update the board when the AI makes no change", async () => {
    global.fetch = vi.fn<typeof fetch>(async () =>
      ({ ok: true, json: async () => ({ response: "There are 2 cards.", board: null }) }) as Response
    );
    const { onBoardUpdate } = renderSidebar();

    await sendMessage("How many cards?");

    expect(await screen.findByText("There are 2 cards.")).toBeInTheDocument();
    expect(onBoardUpdate).not.toHaveBeenCalled();
  });

  it("shows the backend error detail when the AI request fails", async () => {
    global.fetch = vi.fn<typeof fetch>(async () =>
      ({
        ok: false,
        json: async () => ({
          detail: "OpenRouter is rate limited right now. Please try again in a moment.",
        }),
      }) as Response
    );
    renderSidebar();

    await sendMessage("Move card-1 to Done");

    expect(await screen.findByText(/rate limited right now/i)).toBeInTheDocument();
  });
});
