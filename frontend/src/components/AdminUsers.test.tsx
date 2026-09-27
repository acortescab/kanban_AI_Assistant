import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AdminUsers } from "@/components/AdminUsers";
import { createFakeServer, failWith, type FakeServer } from "@/test/fakeServer";

let server: FakeServer;

beforeEach(() => {
  server = createFakeServer();
  const alice = server.addUser("alice");
  server.addBoard(alice.id, "Alice board");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminUsers", () => {
  it("lists users with their board counts", async () => {
    render(<AdminUsers currentUserId="user-1" />);

    const alice = await screen.findByTestId("user-row-alice");
    expect(alice).toHaveTextContent("alice");
    expect(within(alice).getAllByRole("cell")[1]).toHaveTextContent("1");
    expect(screen.getByTestId("user-row-user")).toHaveTextContent("(you)");
  });

  it("does not let admins change or delete themselves", async () => {
    render(<AdminUsers currentUserId="user-1" />);

    const self = await screen.findByTestId("user-row-user");
    expect(within(self).getByLabelText("Role for user")).toBeDisabled();
    expect(within(self).queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("changes a user's role", async () => {
    render(<AdminUsers currentUserId="user-1" />);

    await userEvent.selectOptions(await screen.findByLabelText("Role for alice"), "admin");

    await waitFor(() => expect(server.accounts.get("alice")!.user.role).toBe("admin"));
    expect(screen.getByLabelText("Role for alice")).toHaveValue("admin");
  });

  it("deletes a user after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminUsers currentUserId="user-1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete user alice" }));

    await waitFor(() => expect(screen.queryByTestId("user-row-alice")).not.toBeInTheDocument());
    expect(server.accounts.has("alice")).toBe(false);
  });

  it("keeps the user when deletion is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<AdminUsers currentUserId="user-1" />);

    await userEvent.click(await screen.findByRole("button", { name: "Delete user alice" }));

    expect(screen.getByTestId("user-row-alice")).toBeInTheDocument();
    expect(server.accounts.has("alice")).toBe(true);
  });

  it("shows server errors", async () => {
    render(<AdminUsers currentUserId="user-1" />);
    await screen.findByTestId("user-row-alice");
    server.interceptor = () => failWith(404, "User not found");

    await userEvent.selectOptions(screen.getByLabelText("Role for alice"), "admin");

    expect(await screen.findByRole("alert")).toHaveTextContent("User not found");
  });

  it("shows an error when the list cannot be loaded", async () => {
    server.interceptor = () => failWith(403, "Admins only.");

    render(<AdminUsers currentUserId="user-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Admins only.");
  });
});
