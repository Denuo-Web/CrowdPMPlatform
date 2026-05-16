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
    const { auth, signOut: firebaseSignOut } = await loadFirebaseAuth();
    await firebaseSignOut(auth);
  }, []);

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
