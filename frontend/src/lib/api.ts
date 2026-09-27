import type { BoardData } from "@/lib/kanban";

export type Role = "user" | "admin";

export type User = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  createdAt: string;
};

export type AdminUser = User & { boardCount: number };

export type BoardSummary = {
  id: string;
  title: string;
  description: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  ownerName: string;
  memberCount: number; // people the board is shared with, not counting the owner
};

export type BoardMember = {
  userId: string;
  username: string;
  displayName: string;
  role: "owner" | "member";
};

export type ActivityEntry = {
  id: number;
  actor: string;
  message: string;
  createdAt: string;
};

// A board's content plus the version it was read or saved at (the server's ETag).
export type VersionedBoard = { board: BoardData; version: number };

export type ChatTurn = { role: "user" | "assistant"; content: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// Fired on any 401 so the app can drop back to the sign-in screen when a session expires.
export const UNAUTHORIZED_EVENT = "kanban:unauthorized";

const readDetail = async (response: Response) => {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) {
      return body.detail;
    }
    // FastAPI validation errors come back as a list of {msg} objects.
    if (Array.isArray(body.detail) && body.detail.length > 0) {
      const first = body.detail[0] as { msg?: string };
      if (first.msg) {
        return first.msg.replace(/^Value error, /, "");
      }
    }
  } catch {
    // Fall back to the generic message below.
  }
  return "Something went wrong. Please try again.";
};

const send = async (
  path: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
) => {
  const response = await fetch(path, {
    method,
    headers:
      body === undefined && Object.keys(headers).length === 0
        ? undefined
        : { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/login")) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(response.status, await readDetail(response));
  }
  return response;
};

const request = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
  const response = await send(path, method, body);
  return (response.status === 204 ? undefined : await response.json()) as T;
};

// ETag is "<version>"; the backend refuses a save whose If-Match is not the current version.
const readVersion = (response: Response) =>
  Number((response.headers.get("ETag") ?? "0").replace(/"/g, ""));

const versioned = async (response: Response): Promise<VersionedBoard> => ({
  board: (await response.json()) as BoardData,
  version: readVersion(response),
});

export const api = {
  me: () => request<User>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<User>("/api/auth/login", "POST", { username, password }),
  register: (username: string, password: string, displayName: string) =>
    request<User>("/api/auth/register", "POST", { username, password, displayName }),
  logout: () => request<void>("/api/auth/logout", "POST"),
  updateProfile: (displayName: string) =>
    request<User>("/api/auth/me", "PATCH", { displayName }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/auth/password", "POST", { currentPassword, newPassword }),
  deleteAccount: (password: string) => request<void>("/api/auth/me", "DELETE", { password }),

  listBoards: () => request<BoardSummary[]>("/api/boards"),
  createBoard: (title: string, description = "") =>
    request<BoardSummary>("/api/boards", "POST", { title, description }),
  updateBoard: (boardId: string, changes: { title?: string; description?: string }) =>
    request<BoardSummary>(`/api/boards/${boardId}`, "PATCH", changes),
  deleteBoard: (boardId: string) => request<void>(`/api/boards/${boardId}`, "DELETE"),
  getBoardData: async (boardId: string) =>
    versioned(await send(`/api/boards/${boardId}/data`, "GET")),
  saveBoardData: async (boardId: string, board: BoardData, version: number) =>
    versioned(
      await send(`/api/boards/${boardId}/data`, "PUT", board, { "If-Match": `"${version}"` })
    ),
  chat: async (boardId: string, question: string, history: ChatTurn[]) => {
    const response = await send(`/api/boards/${boardId}/ai/chat`, "POST", { question, history });
    const reply = (await response.json()) as { response: string; board: BoardData | null };
    return { ...reply, version: readVersion(response) };
  },

  listActivity: (boardId: string) =>
    request<ActivityEntry[]>(`/api/boards/${boardId}/activity`),
  listMembers: (boardId: string) => request<BoardMember[]>(`/api/boards/${boardId}/members`),
  addMember: (boardId: string, username: string) =>
    request<BoardMember[]>(`/api/boards/${boardId}/members`, "POST", { username }),
  removeMember: (boardId: string, userId: string) =>
    request<void>(`/api/boards/${boardId}/members/${userId}`, "DELETE"),

  listUsers: () => request<AdminUser[]>("/api/admin/users"),
  setRole: (userId: string, role: Role) =>
    request<User>(`/api/admin/users/${userId}`, "PATCH", { role }),
  deleteUser: (userId: string) => request<void>(`/api/admin/users/${userId}`, "DELETE"),
};
