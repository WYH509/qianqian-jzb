import { createContext, useContext, useState, type ReactNode } from 'react';
import { apiFetch } from './client';

export interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
}

export interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState<string | null>(null);

  async function login(user: string, password: string): Promise<void> {
    const res = await apiFetch<{ data?: { username?: string } }>('/api/v1/auth/login', {
      json: { username: user, password },
    });
    setIsAuthenticated(true);
    setUsername(res?.data?.username ?? user);
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch<void>('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // 后端登出失败（如 token 过期）也照常清空本地状态
    }
    setIsAuthenticated(false);
    setUsername(null);
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, username, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
