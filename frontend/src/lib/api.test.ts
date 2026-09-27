import { vi } from "vitest";
import { api, ApiError, UNAUTHORIZED_EVENT } from "@/lib/api";

const respond = (status: number, body?: unknown, raw?: string) => {
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status })
  );
  global.fetch = fetchMock;
  return fetchMock;
};

describe("api client", () => {
  it("sends JSON bodies with the right method and headers", async () => {
    const fetchMock = respond(201, { id: "board-2" });

    await api.createBoard("Launch", "Plan");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/boards");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ title: "Launch", description: "Plan" });
  });

  it("sends no body or content type for reads", async () => {
    const fetchMock = respond(200, []);

    await api.listBoards();

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toBeUndefined();
  });

  it("resolves 204 responses without reading a body", async () => {
    respond(204);

    await expect(api.deleteBoard("board-1")).resolves.toBeUndefined();
  });

  it("raises the server's detail message", async () => {
    respond(409, { detail: "That username is already taken." });

    const error = await api.register("user", "password123", "").catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe("That username is already taken.");
  });

  it("turns validation errors into a readable message", async () => {
    respond(422, { detail: [{ msg: "Value error, Labels must be unique." }] });

    await expect(api.getBoardData("board-1")).rejects.toThrow("Labels must be unique.");
  });

  it("falls back to a generic message for unreadable errors", async () => {
    respond(500, undefined, "<html>oops</html>");

    await expect(api.listBoards()).rejects.toThrow("Something went wrong. Please try again.");
  });

  it("reads the board version from the ETag and sends it back as If-Match", async () => {
    const board = { columns: [], cards: {} };
    global.fetch = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(board), { status: 200, headers: { ETag: '"7"' } })
    );

    await expect(api.getBoardData("board-1")).resolves.toEqual({ board, version: 7 });
    const saved = await api.saveBoardData("board-1", board, 7);

    const [, init] = vi.mocked(global.fetch).mock.calls[1];
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({ "Content-Type": "application/json", "If-Match": '"7"' });
    expect(saved.version).toBe(7);
  });

  it("returns the AI reply with the version it left the board at", async () => {
    global.fetch = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ response: "Hi", board: null }), {
          status: 200,
          headers: { ETag: '"3"' },
        })
    );

    await expect(api.chat("board-1", "Hi", [])).resolves.toEqual({
      response: "Hi",
      board: null,
      version: 3,
    });
  });

  it("announces an expired session on any 401 except a failed login", async () => {
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);

    respond(401, { detail: "Invalid username or password." });
    await api.login("user", "wrong").catch(() => {});
    expect(listener).not.toHaveBeenCalled();

    respond(401, { detail: "Not signed in." });
    await api.listBoards().catch(() => {});
    expect(listener).toHaveBeenCalledTimes(1);

    window.removeEventListener(UNAUTHORIZED_EVENT, listener);
  });
});
