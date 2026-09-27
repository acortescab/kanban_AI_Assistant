"use client";

import { useState, type FormEvent } from "react";
import { api, errorMessage, type User } from "@/lib/api";

type AuthScreenProps = {
  onAuthenticated: (user: User) => void;
};

const inputClass =
  "w-full rounded-xl border border-[rgba(3,33,71,0.15)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]";

export const AuthScreen = ({ onAuthenticated }: AuthScreenProps) => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLogin = mode === "login";

  const switchMode = () => {
    setMode(isLogin ? "register" : "login");
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const user = isLogin
        ? await api.login(username, password)
        : await api.register(username, password, displayName);
      onAuthenticated(user);
    } catch (caught) {
      setError(errorMessage(caught));
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface)] px-4 py-12">
      <div className="w-full max-w-md rounded-3xl border border-[var(--stroke)] border-t-4 border-t-[var(--accent-yellow)] bg-white p-8 shadow-[var(--shadow)]">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
          Kanban Studio
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold text-[var(--navy-dark)]">
          {isLogin ? "Sign in" : "Create account"}
        </h1>
        <p className="mt-2 text-sm text-[var(--gray-text)]">
          {isLogin
            ? "Sign in to your project boards."
            : "Pick a username and a password of at least 8 characters."}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="username" className="mb-2 block text-sm font-medium text-[var(--navy-dark)]">
              Username
            </label>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={inputClass}
              autoComplete="username"
              required
            />
          </div>

          {isLogin ? null : (
            <div>
              <label
                htmlFor="display-name"
                className="mb-2 block text-sm font-medium text-[var(--navy-dark)]"
              >
                Display name <span className="font-normal text-[var(--gray-text)]">(optional)</span>
              </label>
              <input
                id="display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                className={inputClass}
                autoComplete="name"
              />
            </div>
          )}

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-[var(--navy-dark)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
            />
          </div>

          {error ? (
            <p className="text-sm font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-full bg-[var(--secondary-purple)] px-4 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:opacity-70"
          >
            {isLogin ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--gray-text)]">
          {isLogin ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={switchMode}
            className="font-semibold text-[var(--primary-blue)] hover:underline"
          >
            {isLogin ? "Create an account" : "Sign in instead"}
          </button>
        </p>
      </div>
    </main>
  );
};
