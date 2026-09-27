import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/page";
import { UNAUTHORIZED_EVENT } from "@/lib/api";
import { createFakeServer, type FakeServer } from "@/test/fakeServer";

let server: FakeServer;

const signIn = async (username = "user", password = "password") => {
  await userEvent.type(await screen.findByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
};

beforeEach(() => {
  window.localStorage.clear();
  server = createFakeServer({ signedIn: false });
});

describe("Authentication", () => {
  it("requires sign in before showing any board", async () => {
    render(<Home />);

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByTestId(/^column-/)).not.toBeInTheDocument();
  });

  it("rejects invalid credentials", async () => {
    render(<Home />);
    await signIn("user", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password.");
    expect(screen.queryByTestId(/^column-/)).not.toBeInTheDocument();
  });

  it("signs in and opens the user's board", async () => {
    render(<Home />);
    await signIn();

    expect(await screen.findByRole("heading", { name: /kanban studio/i })).toBeInTheDocument();
    expect(await screen.findAllByTestId(/^column-/)).toHaveLength(5);
    expect(screen.getByTestId("current-user")).toHaveTextContent("Demo User");
  });

  it("restores an existing session without asking to sign in", async () => {
    server.sessionUserId = "user-1";
    render(<Home />);

    expect(await screen.findAllByTestId(/^column-/)).toHaveLength(5);
    expect(screen.queryByRole("heading", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("registers a new account and opens its starter board", async () => {
    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /create an account/i }));
    expect(screen.getByRole("heading", { name: /create account/i })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Username"), "newbie");
    await userEvent.type(screen.getByLabelText(/display name/i), "New Person");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByLabelText("Board title")).toHaveValue("My first board");
    expect(screen.getByTestId("current-user")).toHaveTextContent("New Person");
    expect(screen.queryByRole("button", { name: "Users" })).not.toBeInTheDocument();
  });

  it("shows why a registration was rejected", async () => {
    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: /create an account/i }));

    await userEvent.type(screen.getByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That username is already taken.");

    await userEvent.clear(screen.getByLabelText("Username"));
    await userEvent.type(screen.getByLabelText("Username"), "shorty");
    await userEvent.clear(screen.getByLabelText("Password"));
    await userEvent.type(screen.getByLabelText("Password"), "short");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at least 8 characters");
  });

  it("switching between sign in and register clears the error", async () => {
    render(<Home />);
    await signIn("user", "wrong");
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /create an account/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign in instead/i }));
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("logs out and keeps saved changes for the next sign in", async () => {
    render(<Home />);
    await signIn();
    const column = (await screen.findAllByTestId(/^column-/))[0];
    await userEvent.click(within(column).getByRole("button", { name: /add a card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "Saved card");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
    await waitFor(() => expect(server.puts).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: /log out/i }));
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(server.sessionUserId).toBeNull();

    await signIn();
    expect(await screen.findByText("Saved card")).toBeInTheDocument();
  });

  it("returns to sign in when the session expires", async () => {
    server.sessionUserId = "user-1";
    render(<Home />);
    await screen.findAllByTestId(/^column-/);

    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });
});
