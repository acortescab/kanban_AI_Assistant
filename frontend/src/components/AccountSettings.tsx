"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { api, type User } from "@/lib/api";

type AccountSettingsProps = {
  user: User;
  onUserChange: (user: User) => void;
  onAccountDeleted: () => void;
};

type Status = { kind: "ok" | "error"; message: string } | null;

const inputClass =
  "w-full rounded-lg border border-[rgba(3,33,71,0.15)] bg-white px-3 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";
const buttonClass =
  "rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-70";

const errorMessage = (caught: unknown) =>
  caught instanceof Error ? caught.message : "Something went wrong.";

const StatusLine = ({ status }: { status: Status }) =>
  status ? (
    <p
      className={status.kind === "ok" ? "text-sm text-green-700" : "text-sm font-medium text-red-600"}
      role={status.kind === "ok" ? "status" : "alert"}
    >
      {status.message}
    </p>
  ) : null;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-2xl border border-[var(--stroke)] bg-white p-5 shadow-[0_8px_24px_rgba(3,33,71,0.06)]">
    <h3 className="font-display text-base font-semibold text-[var(--navy-dark)]">{title}</h3>
    <div className="mt-3">{children}</div>
  </section>
);

export const AccountSettings = ({ user, onUserChange, onAccountDeleted }: AccountSettingsProps) => {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [profileStatus, setProfileStatus] = useState<Status>(null);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [passwordStatus, setPasswordStatus] = useState<Status>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteStatus, setDeleteStatus] = useState<Status>(null);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onUserChange(await api.updateProfile(displayName));
      setProfileStatus({ kind: "ok", message: "Profile saved." });
    } catch (caught) {
      setProfileStatus({ kind: "error", message: errorMessage(caught) });
    }
  };

  const savePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) {
      setPasswordStatus({ kind: "error", message: "The new passwords do not match." });
      return;
    }
    try {
      await api.changePassword(passwords.current, passwords.next);
      setPasswords({ current: "", next: "", confirm: "" });
      setPasswordStatus({
        kind: "ok",
        message: "Password changed. Other devices have been signed out.",
      });
    } catch (caught) {
      setPasswordStatus({ kind: "error", message: errorMessage(caught) });
    }
  };

  const deleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!window.confirm("Delete your account and all of your boards? This cannot be undone.")) {
      return;
    }
    try {
      await api.deleteAccount(deletePassword);
      onAccountDeleted();
    } catch (caught) {
      setDeleteStatus({ kind: "error", message: errorMessage(caught) });
    }
  };

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:px-6" data-testid="account-settings">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Account</h2>
          <p className="text-sm text-[var(--gray-text)]">
            Signed in as <strong className="text-[var(--navy-dark)]">{user.username}</strong>
            {user.role === "admin" ? " (admin)" : ""}
          </p>
        </div>

        <Section title="Profile">
          <form onSubmit={saveProfile} className="space-y-3">
            <label className="block text-sm font-medium text-[var(--navy-dark)]">
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={60}
                className={`${inputClass} mt-1`}
              />
            </label>
            <StatusLine status={profileStatus} />
            <button type="submit" className={buttonClass}>
              Save profile
            </button>
          </form>
        </Section>

        <Section title="Change password">
          <form onSubmit={savePassword} className="space-y-3">
            <label className="block text-sm font-medium text-[var(--navy-dark)]">
              Current password
              <input
                type="password"
                value={passwords.current}
                onChange={(event) => setPasswords((prev) => ({ ...prev, current: event.target.value }))}
                autoComplete="current-password"
                className={`${inputClass} mt-1`}
                required
              />
            </label>
            <label className="block text-sm font-medium text-[var(--navy-dark)]">
              New password
              <input
                type="password"
                value={passwords.next}
                onChange={(event) => setPasswords((prev) => ({ ...prev, next: event.target.value }))}
                autoComplete="new-password"
                minLength={8}
                className={`${inputClass} mt-1`}
                required
              />
            </label>
            <label className="block text-sm font-medium text-[var(--navy-dark)]">
              Confirm new password
              <input
                type="password"
                value={passwords.confirm}
                onChange={(event) => setPasswords((prev) => ({ ...prev, confirm: event.target.value }))}
                autoComplete="new-password"
                className={`${inputClass} mt-1`}
                required
              />
            </label>
            <StatusLine status={passwordStatus} />
            <button type="submit" className={buttonClass}>
              Change password
            </button>
          </form>
        </Section>

        <Section title="Delete account">
          <form onSubmit={deleteAccount} className="space-y-3">
            <p className="text-sm text-[var(--gray-text)]">
              Permanently removes your account and every board you own.
            </p>
            <label className="block text-sm font-medium text-[var(--navy-dark)]">
              Confirm with your password
              <input
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                autoComplete="current-password"
                className={`${inputClass} mt-1`}
                required
              />
            </label>
            <StatusLine status={deleteStatus} />
            <button
              type="submit"
              className="rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-600 transition hover:bg-red-50"
            >
              Delete account
            </button>
          </form>
        </Section>
      </div>
    </main>
  );
};
