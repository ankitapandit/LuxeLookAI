/**
 * hooks/useAuth.tsx — Shared authentication state
 * ================================================
 * Provides one app-wide source of truth for the current session.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from "react";
import {
  AUTH_CHANGED_EVENT,
  AUTH_USER_ID_KEY,
  getStoredAuth,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
} from "@/services/api";
import toast from "react-hot-toast";

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  signup: (email: string, password: string) => Promise<boolean>;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readAuthState(): AuthState {
  const { token, userId } = getStoredAuth();
  return {
    isAuthenticated: !!token,
    userId,
    loading: false,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    userId: null,
    loading: true,
  });

  useEffect(() => {
    const syncFromStorage = () => setState(readAuthState());
    syncFromStorage();

    window.addEventListener("storage", syncFromStorage);
    window.addEventListener(AUTH_CHANGED_EVENT, syncFromStorage);
    return () => {
      window.removeEventListener("storage", syncFromStorage);
      window.removeEventListener(AUTH_CHANGED_EVENT, syncFromStorage);
    };
  }, []);

  const signup = useCallback(async (email: string, password: string) => {
    try {
      const res = await apiSignup(email, password);
      setState({ isAuthenticated: true, userId: res.user_id, loading: false });
      toast.success("Welcome to LuxeLook AI!");
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Signup failed");
      return false;
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await apiLogin(email, password);
      setState({ isAuthenticated: true, userId: res.user_id, loading: false });
      toast.success("Welcome back!");
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Login failed");
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setState({ isAuthenticated: false, userId: null, loading: false });
    toast.success("Logged out");
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    signup,
    login,
    logout,
  }), [state, signup, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function getStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_USER_ID_KEY);
}
