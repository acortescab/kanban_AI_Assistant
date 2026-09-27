import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { Workspace } from "@/components/Workspace";
import { createFakeServer, DEMO_USER, type FakeServer } from "@/test/fakeServer";

let server: FakeServer;

const renderWorkspace = (user = DEMO_USER) => {
  const onLogout = vi.fn();
  const onUserChange = vi.fn();
  render(<Workspace user={user} onUserChange={onUserChange} onLogout={onLogout} />);
  return { onLogout, onUserChange };
};

beforeEach(() => {
  window.localStorage.clear();
  server = createFakeServer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Workspace", () => {
  it("opens the first board", async () => {
    renderWorkspace();

    expect(await screen.findByLabelText("Board title")).toHaveValue("Project Board");
    expect(screen.getByLabelText("Current board")).toHaveValue("board-1");
  });

  it("switches boards from the header and remembers the choice", async () => {
    server.addBoard("user-1", "Second board", undefined, "board-2");
    renderWorkspace();
    await screen.findAllByTestId(/^column-/);

    await userEvent.selectOptions(screen.getByLabelText("Current board"), "board-2");

    expect(await screen.findByLabelText("Board title")).toHaveValue("Second board");
    expect(within(await screen.findByTestId("column-col-0")).getByText("Drop a card here")).toBeInTheDocument();
    expect(window.localStorage.getItem("kanban:last-board:user-1")).toBe("board-2");
  });

  it("reopens the remembered board", async () => {
    server.addBoard("user-1", "Second board", undefined, "board-2");
    window.localStorage.setItem("kanban:last-board:user-1", "board-2");

    renderWorkspace();

    expect(await screen.findByLabelText("Board title")).toHaveValue("Second board");
  });

  it("falls back to the first board when the remembered one is gone", async () => {
    window.localStorage.setItem("kanban:last-board:user-1", "board-deleted");

    renderWorkspace();

    expect(await screen.findByLabelText("Board title")).toHaveValue("Project Board");
  });

  it("shows the overview when the user has no boards", async () => {
    server.boards.clear();
    renderWorkspace();

    expect(await screen.findByTestId("boards-overview")).toHaveTextContent("0 boards");
    expect(screen.queryByLabelText("Current board")).not.toBeInTheDocument();
  });

  it("lists boards with their card counts", async () => {
    server.addBoard("user-1", "Second board", undefined, "board-2");
    renderWorkspace();
    await screen.findAllByTestId(/^column-/);

    await userEvent.click(screen.getByRole("button", { name: "All boards" }));

    const first = await screen.findByTestId("board-tile-board-1");
    expect(first).toHaveTextContent("Project Board");
    expect(first).toHaveTextContent("8 cards");
    expect(screen.getByTestId("board-tile-board-2")).toHaveTextContent("0 cards");
  });

  it("creates a board from the overview and opens it", async () => {
    renderWorkspace();
    await screen.findAllByTestId(/^column-/);
    await userEvent.click(screen.getByRole("button", { name: "All boards" }));

    await userEvent.type(await screen.findByLabelText("New board title"), "Launch");
    await userEvent.type(screen.getByLabelText("New board description"), "Q4 launch plan");
    await userEvent.click(screen.getByRole("button", { name: /create board/i }));

    expect(await screen.findByLabelText("Board title")).toHaveValue("Launch");
    expect(screen.getByLabelText("Board description")).toHaveValue("Q4 launch plan");
    const options = within(screen.getByLabelText("Current board")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Project Board", "Launch"]);
  });

  it("opens a board from its tile", async () => {
    server.addBoard("user-1", "Second board", undefined, "board-2");
    renderWorkspace();
    await screen.findAllByTestId(/^column-/);
    await userEvent.click(screen.getByRole("button", { name: "All boards" }));

    await userEvent.click(await screen.findByRole("button", { name: "Second board" }));

    expect(await screen.findByLabelText("Board title")).toHaveValue("Second board");
  });

  it("deletes a board after confirmation", async () => {
    server.addBoard("user-1", "Second board", undefined, "board-2");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkspace();
    await screen.findAllByTestId(/^column-/);
    await userEvent.click(screen.getByRole("button", { name: "All boards" }));

    await userEvent.click(await screen.findByRole("button", { name: "Delete board Second board" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete "Second board"'));
    await waitFor(() => expect(screen.queryByTestId("board-tile-board-2")).not.toBeInTheDocument());
    expect(server.boards.has("board-2")).toBe(false);
  });

  it("keeps the board when deletion is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace();
    await screen.findAllByTestId(/^column-/);
    await userEvent.click(screen.getByRole("button", { name: "All boards" }));

    await userEvent.click(await screen.findByRole("button", { name: "Delete board Project Board" }));

    expect(screen.getByTestId("board-tile-board-1")).toBeInTheDocument();
    expect(server.boards.has("board-1")).toBe(true);
  });

  it("shows boards shared with the user and returns to the overview after leaving one", async () => {
    const alice = server.addUser("alice");
    alice.displayName = "Alice";
    const sharedId = server.addBoard(alice.id, "Alice's plan");
    server.boards.get(sharedId)!.memberIds.push("user-1");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkspace();
    await screen.findAllByTestId(/^column-/);

    await userEvent.click(screen.getByRole("button", { name: "All boards" }));
    const tile = await screen.findByTestId(`board-tile-${sharedId}`);
    expect(tile).toHaveTextContent("Shared by Alice");
    expect(within(tile).queryByRole("button", { name: /delete board/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("board-tile-board-1")).not.toHaveTextContent("shared with");

    await userEvent.click(within(tile).getByRole("button", { name: "Alice's plan" }));
    await userEvent.click(await screen.findByRole("button", { name: /members/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Leave board" }));

    expect(await screen.findByTestId("boards-overview")).toBeInTheDocument();
    expect(screen.queryByTestId(`board-tile-${sharedId}`)).not.toBeInTheDocument();
  });

  it("keeps the header's board name in sync with a rename", async () => {
    renderWorkspace();
    const title = await screen.findByLabelText("Board title");

    await userEvent.clear(title);
    await userEvent.type(title, "Renamed{enter}");

    await waitFor(() =>
      expect(within(screen.getByLabelText("Current board")).getByRole("option")).toHaveTextContent("Renamed")
    );
  });

  it("shows the Users screen only to admins", async () => {
    renderWorkspace({ ...DEMO_USER, role: "user" });
    await screen.findAllByTestId(/^column-/);

    expect(screen.queryByRole("button", { name: "Users" })).not.toBeInTheDocument();
  });

  it("navigates to account settings and the admin screen", async () => {
    renderWorkspace();
    await screen.findAllByTestId(/^column-/);

    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByTestId("account-settings")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Users" }));
    expect(await screen.findByTestId("user-row-user")).toBeInTheDocument();
  });

  it("shows an error when boards cannot be loaded", async () => {
    server.interceptor = () => new Response("nope", { status: 500 });

    renderWorkspace();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load your boards/i);
  });

  it("logs out from the header", async () => {
    const { onLogout } = renderWorkspace();

    await userEvent.click(screen.getByRole("button", { name: /log out/i }));

    expect(onLogout).toHaveBeenCalled();
  });
});
