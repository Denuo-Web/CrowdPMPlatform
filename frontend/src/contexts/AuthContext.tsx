import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { connectAuthEmulator, getAuth, onIdTokenChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { getFirebaseApp } from "../lib/firebase";
import { setAuthTokenProvider } from "../lib/api";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const firebaseApp = useMemo(() => getFirebaseApp(), []);
  const auth = useMemo(() => getAuth(firebaseApp), [firebaseApp]);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST?.trim();
    if (import.meta.env.DEV && emulatorHost) {
      const endpoint = emulatorHost.startsWith("http") ? emulatorHost : `http://${emulatorHost}`;
      connectAuthEmulator(auth, endpoint, { disableWarnings: true });
    }
  }, [auth]);

  useEffect(() => {
    setAuthTokenProvider(() => tokenRef.current);
    return () => {
      setAuthTokenProvider(null);
    };
  }, []);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        tokenRef.current = null;
        setToken(null);
        setStatus("unauthenticated");
        return;
      }
      try {
        const freshToken = await nextUser.getIdToken();
        tokenRef.current = freshToken;
        setToken(freshToken);
        setStatus("authenticated");
      }
      catch (err) {
        console.error("Unable to refresh Firebase ID token", err);
        tokenRef.current = null;
        setToken(null);
        setStatus("unauthenticated");
      }
    });
    return unsubscribe;
  }, [auth]);

  const login = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, [auth]);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, [auth]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    token,
    login,
    logout,
  }), [status, user, token, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
