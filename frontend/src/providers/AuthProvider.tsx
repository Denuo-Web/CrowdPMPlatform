import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { safeLocalStorageRemove } from "../lib/storage";
import type { AdminRole } from "@crowdpm/types";
import type { IdTokenResult, User, UserCredential } from "firebase/auth";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  roles: AdminRole[];
  isModerator: boolean;
  isSuperAdmin: boolean;
  canAccessAdmin: boolean;
  canRunSmokeTests: boolean;
  signIn: (email: string, password: string) => Promise<UserCredential>;
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const SMOKE_TESTER_EMAIL = "smoke-tester@crowdpm.dev";
const PRODUCTION_HOST_SUFFIXES = [".web.app", ".firebaseapp.com"];

async function loadFirebaseAuth() {
  const [{ auth }, firebaseAuth] = await Promise.all([
    import("../lib/firebase"),
    import("firebase/auth"),
  ]);

  return { auth, ...firebaseAuth };
}

function normalizeRole(value: unknown): AdminRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if ([ "super_admin", "super-admin", "superadmin", "admin" ].includes(normalized)) {
    return "super_admin";
  }
  if ([ "moderator", "mod" ].includes(normalized)) {
    return "moderator";
  }
  return null;
}

function extractRoles(tokenResult: IdTokenResult | null): AdminRole[] {
  if (!tokenResult) return [];
  const out = new Set<AdminRole>();
  const claims = tokenResult.claims as Record<string, unknown>;
  if (Array.isArray(claims.roles)) {
    claims.roles.forEach((entry) => {
      const normalized = normalizeRole(entry);
      if (normalized) out.add(normalized);
    });
  }
  if (claims.admin === true) {
    out.add("super_admin");
  }
  return Array.from(out);
}

function isLocalEmulatorSmokeTester(user: User | null): boolean {
  const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST?.trim();
  const hostname = typeof window === "undefined" ? "" : window.location.hostname;
  return (
    Boolean(emulatorHost)
    && !PRODUCTION_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    && user?.email?.trim().toLowerCase() === SMOKE_TESTER_EMAIL
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
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
              ["crowdpm:lastSmokeSelection", "crowdpm:lastSmokeBatchCache", "crowdpm:lastMapZoom", "crowdpm:lastTimelineIndex"],
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

  const clearCachesOnSignOut = useCallback(() => {
    queryClient.clear();
    safeLocalStorageRemove(
      ["crowdpm:lastSmokeSelection", "crowdpm:lastSmokeBatchCache", "crowdpm:lastMapZoom", "crowdpm:lastTimelineIndex"],
      { context: "auth:sign-out-clear" }
    );
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
    const { auth, signOut: firebaseSignOut } = await loadFirebaseAuth();
    clearCachesOnSignOut();
    setRoles([]);
    await firebaseSignOut(auth);
  }, [clearCachesOnSignOut]);

  const value = useMemo<AuthContextValue>(
    () => {
      const isSuperAdmin = roles.includes("super_admin");
      const isModerator = roles.includes("moderator") || isSuperAdmin;
      const isLocalSmokeTester = isLocalEmulatorSmokeTester(user);
      return {
        user,
        isLoading,
        roles,
        isModerator,
        isSuperAdmin,
        canAccessAdmin: isModerator || isLocalSmokeTester,
        canRunSmokeTests: isSuperAdmin || isLocalSmokeTester,
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
