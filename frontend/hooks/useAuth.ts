/**
 * hooks/useAuth.ts — Authentication state hook
 * ==============================================
 * Provides login/signup/logout and the current auth state to any component.
 */

import { useState, useEffect, useCallback } from "react";
import { signup as apiSignup, login as apiLogin, logout as apiLogout, isLoggedIn } from "@/services/api";
import toast from "react-hot-toast";

interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  loading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    userId: null,
    loading: true,
  });

  // Hydrate auth state from localStorage on mount
  useEffect(() => {
    setState({
      isAuthenticated: isLoggedIn(),
      userId: localStorage.getItem("luxelook_user_id"),
      loading: false,
    });
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

  return { ...state, signup, login, logout };
}
