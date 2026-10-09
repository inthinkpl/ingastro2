import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("ig_token");
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setTenant(data.tenant);
    } catch {
      localStorage.removeItem("ig_token");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("ig_token", data.token);
    setUser(data.user);
    setTenant(data.tenant);
    return data;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    localStorage.setItem("ig_token", data.token);
    setUser(data.user);
    setTenant(data.tenant);
    return data;
  };

  const logout = () => {
    localStorage.removeItem("ig_token");
    setUser(null);
    setTenant(null);
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
