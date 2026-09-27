"use client";

import { useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { createId, type BoardData } from "@/lib/kanban";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AiChatSidebarProps = {
  boardId: string;
  // Resolves once the board's queued saves are written, so the AI sees the latest board.
  waitForSaves: () => Promise<void>;
  // The AI has already saved the board; version is the one it was saved at.
  onBoardUpdate: (board: BoardData, version: number) => void;
};

// The backend only uses the last 20 messages and rejects more than 40, so a long
// conversation must not send its whole history.
export const MAX_SENT_HISTORY = 20;

export const AiChatSidebar = ({ boardId, waitForSaves, onBoardUpdate }: AiChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId("msg"),
      role: "assistant",
      content: "Ask me to summarize the board, rename columns, or move cards for you.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const question = draft.trim();
    if (!question || isSending) {
      return;
    }

    // The history is the conversation before this question.
    const history = messages.slice(-MAX_SENT_HISTORY).map(({ role, content }) => ({ role, content }));
    setMessages([...messages, { id: createId("msg"), role: "user", content: question }]);
    setDraft("");
    setError("");
    setIsSending(true);

    try {
      await waitForSaves();
      const data = await api.chat(boardId, question, history);

      setMessages((previous) => [
        ...previous,
        { id: createId("msg"), role: "assistant", content: data.response },
      ]);

      if (data.board) {
        onBoardUpdate(data.board, data.version);
      }
    } catch (caught) {
      setError(errorMessage(caught, "Unable to send your message right now."));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <aside className="flex flex-col rounded-2xl border border-[var(--stroke)] bg-white p-4 shadow-[0_8px_24px_rgba(3,33,71,0.06)] lg:w-[340px] lg:shrink-0 xl:w-[380px]">
      <div className="border-b-2 border-[var(--secondary-purple)] pb-2">
        <h2 className="font-display text-base font-semibold text-[var(--navy-dark)]">
          AI Assistant
        </h2>
        <p className="mt-0.5 text-xs text-[var(--gray-text)]">
          Ask for summaries or changes. The board updates automatically.
        </p>
      </div>

      <div
        className="mt-3 flex min-h-[240px] flex-1 flex-col gap-2 overflow-y-auto rounded-xl bg-[var(--surface)] p-3 lg:min-h-0"
        aria-label="AI conversation"
        aria-live="polite"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-[var(--secondary-purple)] px-3 py-2 text-sm text-white"
                : "mr-auto max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-bl-sm border border-[var(--stroke)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)]"
            }
          >
            {message.content}
          </div>
        ))}
      </div>

      {error ? (
        <p className="mt-3 text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <form onSubmit={sendMessage} className="mt-3 space-y-2">
        <label htmlFor="ai-prompt" className="sr-only">
          Message to AI
        </label>
        <textarea
          id="ai-prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask me to move a card or explain the board..."
          rows={3}
          className="w-full resize-none rounded-xl border border-[rgba(3,33,71,0.15)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition placeholder:text-[var(--gray-text)] focus:border-[var(--primary-blue)]"
        />
        <button
          type="submit"
          disabled={isSending}
          className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSending ? "Sending" : "Send message"}
        </button>
      </form>
    </aside>
  );
};