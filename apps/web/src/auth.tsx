import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onAuthLost, setCsrf } from './api';

export interface User {
  id: string;
  email: string;
  displayName: string;
}

interface AuthState {
  user: User | null;
  ready: boolean;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  expired: boolean;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    api<{ user: User; csrfToken: string }>('/auth/me')
      .then((r) => {
        setCsrf(r.csrfToken);
        setUser(r.user);
      })
      .catch(() => setUser(null))
      .finally(() => setReady(true));
    return onAuthLost(() => {
      setUser((u) => {
        if (u) setExpired(true);
        return null;
      });
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User; csrfToken: string }>('/auth/login', { body: { email, password, client: 'web' } });
    setCsrf(r.csrfToken);
    setExpired(false);
    setUser(r.user);
  }, []);
  const register = useCallback(async (name: string, email: string, password: string) => {
    const r = await api<{ user: User; csrfToken: string }>('/auth/register', { body: { name, email, password } });
    setCsrf(r.csrfToken);
    setUser(r.user);
  }, []);
  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setCsrf('');
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, ready, login, register, logout, expired }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
