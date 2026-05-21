import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { safeLocalStorageRemove } from "../lib/storage";
import { readAdminRolesFromClaims, type AdminRole } from "@crowdpm/types";
import type { IdTokenResult, User, UserCredential } from "firebase/auth";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  roles: AdminRole[];
  isModerator: boolean;
  isSuperAdmin: boolean;
  canAccessAdmin: boolean;
  signIn: (email: string, password: string) => Promise<UserCredential>;
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_SCOPED_STORAGE_KEYS = [
  "crowdpm:lastBatchSelection",
  "crowdpm:lastMapZoom",
  "crowdpm:lastTimelineIndex",
];
const E2E_AUTH_STORAGE_KEY = "crowdpm:e2eAuth";

type E2eAuthState = {
  uid?: string;
  email?: string | null;
  roles?: AdminRole[];
};

async function loadFirebaseAuth() {
  const [{ auth }, firebaseAuth] = await Promise.all([
    import("../lib/firebase"),
    import("firebase/auth"),
  ]);

  return { auth, ...firebaseAuth };
}

function extractRoles(tokenResult: IdTokenResult | null): AdminRole[] {
  if (!tokenResult) return [];
  return readAdminRolesFromClaims(tokenResult.claims as Record<string, unknown>);
}

function readE2eAuthState(): E2eAuthState | null {
  if (import.meta.env.VITE_E2E_AUTH_ENABLED !== "true" || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(E2E_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as E2eAuthState;
    const roles = readAdminRolesFromClaims({ roles: parsed.roles });
    return {
      uid: typeof parsed.uid === "string" && parsed.uid.trim() ? parsed.uid : "e2e-user",
      email: typeof parsed.email === "string" ? parsed.email : "e2e@example.com",
      roles,
    };
  }
  catch {
    return null;
  }
}

function createE2eUser(state: E2eAuthState): User {
  const uid = state.uid ?? "e2e-user";
  const email = state.email ?? "e2e@example.com";
  return {
    uid,
    email,
    getIdTokenResult: async () => ({
      claims: { roles: state.roles ?? [] },
    }),
  } as unknown as User;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const e2eInitialAuthState = readE2eAuthState();
  const [user, setUser] = useState<User | null>(() => e2eInitialAuthState ? createE2eUser(e2eInitialAuthState) : null);
  const [isLoading, setIsLoading] = useState(() => import.meta.env.VITE_E2E_AUTH_ENABLED !== "true");
  const [roles, setRoles] = useState<AdminRole[]>(() => e2eInitialAuthState?.roles ?? []);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (import.meta.env.VITE_E2E_AUTH_ENABLED === "true") {
      return;
    }

    let isActive = true;
    let unsubscribe = () => {};

    void loadFirebaseAuth()
      .then(({ auth, onIdTokenChanged }) => {
        if (!isActive) return;
        unsubscribe = onIdTokenChanged(auth, (nextUser) => {
          setUser(nextUser);
          if (!nextUser) {
            setIsLoading(false);
            setRoles([]);
            queryClient.clear();
            safeLocalStorageRemove(
              AUTH_SCOPED_STORAGE_KEYS,
              { context: "auth:clear-storage" }
            );
            return;
          }
          setIsLoading(true);
          void nextUser.getIdTokenResult()
            .then((tokenResult) => {
              if (!isActive) return;
              setRoles(extractRoles(tokenResult));
            })
            .catch(() => {
              if (!isActive) return;
              setRoles([]);
            })
            .finally(() => {
              if (!isActive) return;
              setIsLoading(false);
            });
        });
      })
      .catch((error) => {
        console.error("Unable to initialize Firebase Auth.", error);
        if (!isActive) return;
        setUser(null);
        setIsLoading(false);
        setRoles([]);
      });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [queryClient]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { auth, signInWithEmailAndPassword } = await loadFirebaseAuth();
    return signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { auth, createUserWithEmailAndPassword } = await loadFirebaseAuth();
    return createUserWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signOut = useCallback(async () => {
    if (import.meta.env.VITE_E2E_AUTH_ENABLED === "true") {
      window.localStorage.removeItem(E2E_AUTH_STORAGE_KEY);
      setUser(null);
      setRoles([]);
      queryClient.clear();
      safeLocalStorageRemove(
        AUTH_SCOPED_STORAGE_KEYS,
        { context: "auth:e2e-sign-out-clear" }
      );
      return;
    }

    const { auth, signOut: firebaseSignOut } = await loadFirebaseAuth();
    await firebaseSignOut(auth);
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => {
      const isSuperAdmin = roles.includes("super_admin");
      const isModerator = roles.includes("moderator") || isSuperAdmin;
      return {
        user,
        isLoading,
        roles,
        isModerator,
        isSuperAdmin,
        canAccessAdmin: isModerator,
        signIn,
        signUp,
        signOut,
      };
    },
    [user, isLoading, roles, signIn, signOut, signUp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
