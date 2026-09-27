"use client";

import { useEffect, useState } from "react";
import { AuthScreen } from "@/components/AuthScreen";
import { Workspace } from "@/components/Workspace";
import { api, UNAUTHORIZED_EVENT, type User } from "@/lib/api";

export default function Home() {
  // undefined while the session check is in flight, null when signed out.
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
    const signOut = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, signOut);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signOut);
  }, []);

  if (user === undefined) {
    return null;
  }

  if (user === null) {
    return <AuthScreen onAuthenticated={setUser} />;
  }

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  };

  // Keyed by user so nothing from one account's session survives into the next.
  return <Workspace key={user.id} user={user} onUserChange={setUser} onLogout={handleLogout} />;
}
