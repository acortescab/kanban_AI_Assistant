import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AccountSettings } from "@/components/AccountSettings";
import { createFakeServer, DEMO_USER, type FakeServer } from "@/test/fakeServer";

let server: FakeServer;

const renderSettings = () => {
  const onUserChange = vi.fn();
  const onAccountDeleted = vi.fn();
  render(
    <AccountSettings user={DEMO_USER} onUserChange={onUserChange} onAccountDeleted={onAccountDeleted} />
  );
  return { onUserChange, onAccountDeleted };
};

beforeEach(() => {
  server = createFakeServer();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccountSettings", () => {
  it("shows who is signed in", () => {
    renderSettings();

    expect(screen.getByTestId("account-settings")).toHaveTextContent("Signed in as user (admin)");
  });

  it("saves the display name", async () => {
    const { onUserChange } = renderSettings();

    await userEvent.clear(screen.getByLabelText("Display name"));
    await userEvent.type(screen.getByLabelText("Display name"), "Pat");
    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.");
    expect(onUserChange).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Pat" }));
  });

  it("changes the password", async () => {
    renderSettings();

    await userEvent.type(screen.getByLabelText("Current password"), "password");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "new-password-1");
    await userEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/password changed/i);
    expect(server.accounts.get("user")!.password).toBe("new-password-1");
    expect(screen.getByLabelText("Current password")).toHaveValue("");
  });

  it("refuses mismatched new passwords without calling the server", async () => {
    renderSettings();

    await userEvent.type(screen.getByLabelText("Current password"), "password");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "new-password-2");
    await userEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("do not match");
    expect(server.accounts.get("user")!.password).toBe("password");
  });

  it("shows the server's reason when the current password is wrong", async () => {
    renderSettings();

    await userEvent.type(screen.getByLabelText("Current password"), "nope");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-1");
    await userEvent.type(screen.getByLabelText("Confirm new password"), "new-password-1");
    await userEvent.click(screen.getByRole("button", { name: /change password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Current password is incorrect.");
  });

  it("deletes the account after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onAccountDeleted } = renderSettings();

    await userEvent.type(screen.getByLabelText("Confirm with your password"), "password");
    await userEvent.click(screen.getByRole("button", { name: /delete account/i }));

    await vi.waitFor(() => expect(onAccountDeleted).toHaveBeenCalled());
    expect(server.accounts.has("user")).toBe(false);
  });

  it("does nothing when deletion is not confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { onAccountDeleted } = renderSettings();

    await userEvent.type(screen.getByLabelText("Confirm with your password"), "password");
    await userEvent.click(screen.getByRole("button", { name: /delete account/i }));

    expect(onAccountDeleted).not.toHaveBeenCalled();
    expect(server.accounts.has("user")).toBe(true);
  });

  it("shows why the account could not be deleted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { onAccountDeleted } = renderSettings();

    await userEvent.type(screen.getByLabelText("Confirm with your password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: /delete account/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Password is incorrect.");
    expect(onAccountDeleted).not.toHaveBeenCalled();
  });
});
