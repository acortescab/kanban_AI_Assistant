"use client";

import { useEffect, useState } from "react";
import { api, type ActivityEntry } from "@/lib/api";

type BoardActivityProps = {
  boardId: string;
  // Changes whenever the board is saved, so the list refetches and stays current.
  refreshKey: string;
};

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const BoardActivity = ({ boardId, refreshKey }: BoardActivityProps) => {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listActivity(boardId).then(
      (list) => {
        setEntries(list);
        setError("");
      },
      () => setError("Could not load the activity.")
    );
  }, [boardId, refreshKey]);

  return (
    <section
      className="mx-4 mt-3 max-h-56 overflow-y-auto rounded-2xl border border-[var(--stroke)] bg-white p-4 shadow-[0_8px_24px_rgba(3,33,71,0.06)] sm:mx-6"
      aria-label="Board activity"
      data-testid="board-activity"
    >
      {error ? (
        <p className="text-sm font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : entries === null ? (
        <p className="text-sm text-[var(--gray-text)]">Loading activity...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[var(--gray-text)]">No activity yet.</p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3 text-sm">
              <time className="w-28 shrink-0 text-xs leading-5 text-[var(--gray-text)]" dateTime={entry.createdAt}>
                {formatWhen(entry.createdAt)}
              </time>
              <p className="text-[var(--navy-dark)]">
                <span className="font-semibold">{entry.actor}</span> {entry.message}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
