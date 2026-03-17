import React, { createContext, useContext, useState, useCallback } from "react";

export interface Operator {
  id: string;
  displayName: string;
  lastAuth: string;
}

interface AuthContextValue {
  operator: Operator | null;
  isAuthenticated: boolean;
  login: (operatorId: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_KEY = "atlas-auth-session";
const VALID_OPERATOR_ID = (import.meta.env.VITE_ATLAS_OPERATOR_ID ?? "ATLAS").toUpperCase();
const VALID_PASSWORD    = import.meta.env.VITE_ATLAS_OPERATOR_PASS ?? "atlas2024";

function loadSession(): Operator | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Operator;
    if (!parsed.id || !parsed.lastAuth) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(op: Operator) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(op)); } catch { /* ignore */ }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [operator, setOperator] = useState<Operator | null>(() => loadSession());

  const login = useCallback(async (operatorId: string, password: string) => {
    await new Promise(r => setTimeout(r, 420)); // brief auth delay
    const idMatch  = operatorId.trim().toUpperCase() === VALID_OPERATOR_ID;
    const pwMatch  = password === VALID_PASSWORD;
    if (!idMatch || !pwMatch) {
      return { ok: false, error: "INVALID CREDENTIALS — ACCESS DENIED" };
    }
    const op: Operator = {
      id: operatorId.trim().toUpperCase(),
      displayName: operatorId.trim().toUpperCase(),
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
