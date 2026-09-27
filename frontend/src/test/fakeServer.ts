import { vi } from "vitest";
import type { ActivityEntry, AdminUser, BoardMember, BoardSummary, User } from "@/lib/api";
import { initialData, type BoardData } from "@/lib/kanban";

// An in-memory stand-in for the FastAPI backend, installed as global.fetch. It follows the
// real routes and rules closely enough for component tests to exercise whole flows,
// including board versions (ETag / If-Match) and sharing.

type Account = { user: User; password: string };
type StoredBoard = {
  ownerId: string;
  memberIds: string[];
  version: number;
  summary: Pick<BoardSummary, "id" | "title" | "description" | "createdAt" | "updatedAt">;
  data: BoardData;
  activity: ActivityEntry[]; // newest first; tests seed it directly
};
type ChatReply = { response: string; board: BoardData | null };

// Return a Response to take over a request (to fail or delay it); undefined lets it through.
type Interceptor = (
  method: string,
  path: string,
  body: unknown
) => Promise<Response | undefined> | Response | undefined;

const json = (body: unknown, status = 200, version?: number) =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: {
          "Content-Type": "application/json",
          ...(version === undefined ? {} : { ETag: `"${version}"` }),
        },
      });

const detail = (status: number, message: string) => json({ detail: message }, status);

const clone = <T>(value: T): T => structuredClone(value);

const NOW = "2026-09-01T12:00:00+00:00";

export const DEMO_USER: User = {
  id: "user-1",
  username: "user",
  displayName: "Demo User",
  role: "admin",
  createdAt: NOW,
};

export const emptyBoard = (): BoardData => ({
  columns: ["Backlog", "Discovery", "In Progress", "Review", "Done"].map((title, index) => ({
    id: `col-${index}`,
    title,
    cardIds: [],
  })),
  cards: {},
});

export const createFakeServer = ({ signedIn = true }: { signedIn?: boolean } = {}) => {
  // Starts high so generated ids never collide with the seeded user-1 / board-1.
  let nextId = 100;
  const newId = (prefix: string) => `${prefix}-${nextId++}`;

  const accounts = new Map<string, Account>([["user", { user: clone(DEMO_USER), password: "password" }]]);
  const boards = new Map<string, StoredBoard>();

  const server = {
    sessionUserId: signedIn ? DEMO_USER.id : (null as string | null),
    accounts,
    boards,
    puts: [] as BoardData[],
    chatRequests: [] as { boardId: string; question: string; history: unknown[] }[],
    chatReply: { response: "OK", board: null } as ChatReply,
    interceptor: undefined as Interceptor | undefined,
    fetch: undefined as unknown as ReturnType<typeof vi.fn<typeof fetch>>,

    addBoard(ownerId: string, title: string, data: BoardData = emptyBoard(), id = newId("board")) {
      boards.set(id, {
        ownerId,
        memberIds: [],
        version: 0,
        summary: { id, title, description: "", createdAt: NOW, updatedAt: NOW },
        data: clone(data),
        activity: [],
      });
      return id;
    },

    boardData(boardId: string) {
      return boards.get(boardId)!.data;
    },

    // Simulates another user saving the board, which moves its version on.
    editElsewhere(boardId: string, change: (data: BoardData) => void) {
      const stored = boards.get(boardId)!;
      change(stored.data);
      stored.version += 1;
    },

    addUser(username: string, password = "password123", role: User["role"] = "user") {
      const user: User = { id: newId("user"), username, displayName: "", role, createdAt: NOW };
      accounts.set(username, { user, password });
      return user;
    },
  };

  server.addBoard(DEMO_USER.id, "Project Board", initialData, "board-1");

  const currentAccount = () =>
    [...accounts.values()].find((account) => account.user.id === server.sessionUserId);
  const accountById = (userId: string) =>
    [...accounts.values()].find((account) => account.user.id === userId);

  const summaryOf = (stored: StoredBoard, me: User): BoardSummary => {
    const owner = accountById(stored.ownerId)!.user;
    return {
      ...stored.summary,
      cardCount: Object.keys(stored.data.cards).length,
      isOwner: stored.ownerId === me.id,
      ownerName: owner.displayName || owner.username,
      memberCount: stored.memberIds.length,
    };
  };

  const membersOf = (stored: StoredBoard): BoardMember[] => {
    const toMember = (userId: string, role: BoardMember["role"]): BoardMember => {
      const { user } = accountById(userId)!;
      return { userId, username: user.username, displayName: user.displayName, role };
    };
    return [
      toMember(stored.ownerId, "owner"),
      ...stored.memberIds.map((userId) => toMember(userId, "member")),
    ];
  };

  const canAccess = (stored: StoredBoard | undefined, userId: string): stored is StoredBoard =>
    stored !== undefined && (stored.ownerId === userId || stored.memberIds.includes(userId));

  // Request bodies are whatever the component sent; the routes read fields off them freely.
  const route = (
    method: string,
    path: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any,
    headers: Record<string, string>,
    versionAtStart: number | undefined
  ): Response => {
    if (path === "/api/auth/login" && method === "POST") {
      const account = accounts.get(String(body.username).toLowerCase());
      if (!account || account.password !== body.password) {
        return detail(401, "Invalid username or password.");
      }
      server.sessionUserId = account.user.id;
      return json(account.user);
    }
    if (path === "/api/auth/register" && method === "POST") {
      if (String(body.password).length < 8) {
        return json({ detail: [{ msg: "String should have at least 8 characters" }] }, 422);
      }
      if (accounts.has(String(body.username).toLowerCase())) {
        return detail(409, "That username is already taken.");
      }
      const user = server.addUser(String(body.username).toLowerCase(), body.password);
      user.displayName = String(body.displayName ?? "").trim();
      server.addBoard(user.id, "My first board");
      server.sessionUserId = user.id;
      return json(user, 201);
    }
    if (path === "/api/auth/logout" && method === "POST") {
      server.sessionUserId = null;
      return json(null, 204);
    }

    const account = currentAccount();
    if (!account) {
      return detail(401, "Not signed in.");
    }
    const me = account.user;

    if (path === "/api/auth/me") {
      if (method === "GET") return json(me);
      if (method === "PATCH") {
        me.displayName = String(body.displayName).trim();
        return json(me);
      }
      if (method === "DELETE") {
        if (body.password !== account.password) return detail(400, "Password is incorrect.");
        accounts.delete(me.username);
        server.sessionUserId = null;
        return json(null, 204);
      }
    }
    if (path === "/api/auth/password" && method === "POST") {
      if (body.currentPassword !== account.password) {
        return detail(400, "Current password is incorrect.");
      }
      account.password = body.newPassword;
      return json(null, 204);
    }

    if (path === "/api/boards") {
      if (method === "GET") {
        return json(
          [...boards.values()]
            .filter((stored) => canAccess(stored, me.id))
            .map((stored) => summaryOf(stored, me))
        );
      }
      if (method === "POST") {
        const id = server.addBoard(me.id, String(body.title).trim());
        boards.get(id)!.summary.description = String(body.description ?? "").trim();
        return json(summaryOf(boards.get(id)!, me), 201);
      }
    }

    const boardMatch = path.match(
      /^\/api\/boards\/([^/]+)(\/data|\/ai\/chat|\/activity|\/members(?:\/([^/]+))?)?$/
    );
    if (boardMatch) {
      const [, boardId, sub, memberId] = boardMatch;
      const stored = boards.get(boardId);
      if (!canAccess(stored, me.id)) {
        return detail(404, "Board not found");
      }
      const isOwner = stored.ownerId === me.id;
      if (!sub && method === "GET") return json(summaryOf(stored, me));
      if (!sub && method === "PATCH") {
        Object.assign(stored.summary, body);
        return json(summaryOf(stored, me));
      }
      if (!sub && method === "DELETE") {
        if (!isOwner) return detail(403, "Only the board owner can do that.");
        boards.delete(boardId);
        return json(null, 204);
      }
      if (sub === "/data" && method === "GET") return json(stored.data, 200, stored.version);
      if (sub === "/data" && method === "PUT") {
        const ifMatch = headers["If-Match"];
        if (ifMatch !== undefined && Number(ifMatch.replace(/"/g, "")) !== stored.version) {
          return detail(409, "This board was changed by someone else. Reload to see the latest version.");
        }
        const people = [stored.ownerId, ...stored.memberIds];
        const cards = Object.values(body.cards) as { assigneeId: string | null }[];
        if (cards.some((card) => card.assigneeId && !people.includes(card.assigneeId))) {
          return detail(422, "Cards can only be assigned to people on the board.");
        }
        server.puts.push(clone(body));
        stored.data = clone(body);
        stored.version += 1;
        return json(body, 200, stored.version);
      }
      if (sub === "/ai/chat" && method === "POST") {
        server.chatRequests.push({ boardId, ...body });
        if (server.chatReply.board) {
          if (stored.version !== versionAtStart) {
            return detail(
              409,
              "The board changed while the assistant was working, so its edit was not applied. Please ask again."
            );
          }
          stored.data = clone(server.chatReply.board);
          stored.version += 1;
        }
        return json(server.chatReply, 200, stored.version);
      }
      if (sub?.startsWith("/members")) {
        if (method === "GET") return json(membersOf(stored));
        if (method === "POST") {
          if (!isOwner) return detail(403, "Only the board owner can do that.");
          const target = accounts.get(String(body.username).trim().toLowerCase());
          if (!target) return detail(404, `No user named "${String(body.username).trim()}".`);
          if (target.user.id === stored.ownerId) return detail(409, "The owner already has access.");
          if (stored.memberIds.includes(target.user.id)) {
            return detail(409, "That user is already a member.");
          }
          stored.memberIds.push(target.user.id);
          return json(membersOf(stored), 201);
        }
        if (method === "DELETE" && memberId) {
          if (memberId === stored.ownerId) {
            return detail(400, "The owner cannot be removed from their own board.");
          }
          if (!isOwner && memberId !== me.id) return detail(403, "Only the board owner can do that.");
          if (!stored.memberIds.includes(memberId)) return detail(404, "Member not found");
          stored.memberIds = stored.memberIds.filter((id) => id !== memberId);
          // Like the backend: clear their cards, which moves the version on.
          const assigned = Object.values(stored.data.cards).filter((card) => card.assigneeId === memberId);
          assigned.forEach((card) => (card.assigneeId = null));
          if (assigned.length > 0) {
            stored.version += 1;
          }
          return json(null, 204);
        }
      }
      if (sub === "/activity" && method === "GET") return json(stored.activity);
    }

    if (path.startsWith("/api/admin/")) {
      if (me.role !== "admin") return detail(403, "Admins only.");
      if (path === "/api/admin/users" && method === "GET") {
        const listed: AdminUser[] = [...accounts.values()].map(({ user }) => ({
          ...user,
          boardCount: [...boards.values()].filter((stored) => stored.ownerId === user.id).length,
        }));
        return json(listed);
      }
      const userId = path.split("/").pop();
      const target = accountById(userId ?? "");
      if (!target) return detail(404, "User not found");
      if (userId === me.id) return detail(400, "You cannot change your own account here.");
      if (method === "PATCH") {
        target.user.role = body.role;
        return json(target.user);
      }
      if (method === "DELETE") {
        accounts.delete(target.user.username);
        return json(null, 204);
      }
    }

    return detail(404, `No fake route for ${method} ${path}`);
  };

  server.fetch = vi.fn<typeof fetch>(async (input, init) => {
    const method = init?.method ?? "GET";
    const path = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    // The real AI route reads the board when the request arrives, then saves after the
    // (possibly slow) model call only if nobody changed it meanwhile.
    const chatBoard = path.match(/^\/api\/boards\/([^/]+)\/ai\/chat$/)?.[1];
    const versionAtStart = chatBoard ? boards.get(chatBoard)?.version : undefined;
    const intercepted = await server.interceptor?.(method, path, body);
    return intercepted ?? route(method, path, body, headers, versionAtStart);
  });
  global.fetch = server.fetch;

  return server;
};

export type FakeServer = ReturnType<typeof createFakeServer>;

export const failWith = (status: number, message: string) => detail(status, message);
