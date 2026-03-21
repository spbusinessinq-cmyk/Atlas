import React, { createContext, useContext, useState, useCallback } from "react";

export interface Operator {
  id: string;
  displayName: string;
  lastAuth: string;
}

interface AuthContextValue {
  operator: Operator | null;
  isAuthenticated: boolean;
  login: (code: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = "atlas-auth-session";

const VALID_CODES: string[] = [
  import.meta.env.VITE_ATLAS_ACCESS_CODE ?? "4451",
  import.meta.env.VITE_ATLAS_OPERATOR_PASS ?? "",
].filter(Boolean);

function loadSession(): Operator | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Operator;
    if (!parsed.id || !parsed.lastAuth) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(op: Operator) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(op)); } catch { /* ignore */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(() => loadSession());

  const login = useCallback(async (code: string) => {
    await new Promise(r => setTimeout(r, 420));
    if (!VALID_CODES.includes(code.trim())) {
      return { ok: false, error: "INVALID ACCESS CODE — ENTRY DENIED" };
    }
    const op: Operator = {
      id: "ATLAS",
      displayName: "ATLAS",
      lastAuth: new Date().toISOString(),
    };
    saveSession(op);
    setOperator(op);
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setOperator(null);
  }, []);

  return (
    <AuthContext.Provider value={{ operator, isAuthenticated: !!operator, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
