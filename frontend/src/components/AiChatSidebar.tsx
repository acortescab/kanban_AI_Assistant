"use client";

import { useMemo, useState } from "react";
import { createId, type BoardData } from "@/lib/kanban";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type AiChatSidebarProps = {
  // Resolves once the board's queued saves are written, so the AI sees the latest board.
  waitForSaves: () => Promise<void>;
  onBoardUpdate: (board: BoardData) => void;
};

const readErrorDetail = async (response: Response) => {
  try {
    const body = (await response.json()) as { detail?: string };
    if (typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
  } catch {
    // Fall back to a generic message below.
  }

  return "Unable to send your message right now.";
};

export const AiChatSidebar = ({ waitForSaves, onBoardUpdate }: AiChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId("msg"),
      role: "assistant",
      content:
        "Ask me to summarize the board, rename columns, or move cards for you.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const conversationHistory = useMemo(
    () => messages.map(({ role, content }) => ({ role, content })),
    [messages]
  );

  const sendMessage = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const question = draft.trim();
    if (!question || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: createId("msg"),
      role: "user",
      content: question,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setError("");
    setIsSending(true);

    try {
      await waitForSaves();
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          history: conversationHistory,
        }),
      });

      if (!response.ok) {
        throw new Error(await readErrorDetail(response));
      }

      const data = (await response.json()) as {
        response: string;
        board: BoardData | null;
      };

      setMessages((previous) => [
        ...previous,
        {
          id: createId("msg"),
          role: "assistant",
          content: data.response,
        },
      ]);

      if (data.board) {
        onBoardUpdate(data.board);
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : "Unable to send your message right now."
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <aside className="sticky top-6 flex h-fit flex-col rounded-[32px] border border-[var(--stroke)] bg-white/85 p-5 shadow-[var(--shadow)] backdrop-blur">
      <div className="rounded-2xl border border-[var(--stroke)] bg-[linear-gradient(135deg,rgba(32,157,215,0.08),rgba(117,57,145,0.08))] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
          AI Sidebar
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold text-[var(--navy-dark)]">
          Chat with the board
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--gray-text)]">
          Ask for summaries, changes, or quick actions. Board updates refresh automatically.
        </p>
      </div>

      <div
        className="mt-4 flex min-h-[320px] flex-1 flex-col gap-3 overflow-y-auto rounded-3xl border border-[var(--stroke)] bg-[var(--surface)] p-4"
        aria-label="AI conversation"
        aria-live="polite"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "ml-auto max-w-[85%] rounded-2xl bg-[var(--secondary-purple)] px-4 py-3 text-sm text-white"
                : "mr-auto max-w-[85%] rounded-2xl border border-[var(--stroke)] bg-white px-4 py-3 text-sm text-[var(--navy-dark)]"
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

      <form onSubmit={sendMessage} className="mt-4 space-y-3">
        <label htmlFor="ai-prompt" className="sr-only">
          Message to AI
        </label>
        <textarea
          id="ai-prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask me to move a card or explain the board..."
          rows={4}
          className="w-full rounded-2xl border border-[var(--stroke)] bg-white px-4 py-3 text-sm text-[var(--navy-dark)] outline-none transition placeholder:text-[var(--gray-text)] focus:border-[var(--primary-blue)]"
        />
        <button
          type="submit"
          disabled={isSending}
          className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isSending ? "Sending" : "Send message"}
        </button>
      </form>
    </aside>
  );
};