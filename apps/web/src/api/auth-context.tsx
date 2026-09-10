import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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

  // 硬刷新后 bootstrap 登录态：调用 GET /auth/me，token cookie 自动随请求发，
  // 后端用 authMiddleware 验证 session：200 → 已登录；401 → 未登录（保持 false）
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ data?: { username?: string } }>('/api/v1/auth/me')
      .then((res) => {
        if (cancelled) return;
        const u = res?.data?.username;
        if (u) {
          setIsAuthenticated(true);
          setUsername(u);
        }
      })
      .catch(() => {
        // 未登录 / 网络错 / token 过期 都保持 false（ProtectedRoute 会跳 /login）
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
