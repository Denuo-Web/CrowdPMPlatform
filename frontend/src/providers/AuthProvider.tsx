import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, useCallback } from "react";
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
  type UserCredential,
  type IdTokenResult,
} from "firebase/auth";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "../lib/firebase";
import { safeLocalStorageRemove } from "../lib/storage";
import type { AdminRole } from "@crowdpm/types";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  roles: AdminRole[];
  isModerator: boolean;
  isSuperAdmin: boolean;
  signIn: (email: string, password: string) => Promise<UserCredential>;
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    let isActive = true;
    const unsubscribe = onIdTokenChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setIsLoading(false);
        setRoles([]);
        queryClient.clear();
        safeLocalStorageRemove(
          ["crowdpm:lastSmokeSelection", "crowdpm:lastSmokeBatchCache"],
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
    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [queryClient]);

  const clearCachesOnSignOut = useCallback(() => {
    queryClient.clear();
    safeLocalStorageRemove(
      ["crowdpm:lastSmokeSelection", "crowdpm:lastSmokeBatchCache"],
      { context: "auth:sign-out-clear" }
    );
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      roles,
      isModerator: roles.includes("moderator") || roles.includes("super_admin"),
      isSuperAdmin: roles.includes("super_admin"),
      signIn: (email, password) => signInWithEmailAndPassword(auth, email.trim(), password),
      signUp: (email, password) => createUserWithEmailAndPassword(auth, email.trim(), password),
      signOut: async () => {
        clearCachesOnSignOut();
        setRoles([]);
        await firebaseSignOut(auth);
      },
    }),
    [user, isLoading, roles, clearCachesOnSignOut],
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
