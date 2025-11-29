import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
  type UserCredential,
} from "firebase/auth";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "../lib/firebase";
import { safeLocalStorageRemove } from "../lib/storage";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<UserCredential>;
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setIsLoading(false);
      if (!nextUser) {
        queryClient.clear();
        safeLocalStorageRemove(
          ["crowdpm:lastSmokeSelection", "crowdpm:lastSmokeBatchCache"],
          { context: "auth:clear-storage" }
        );
      }
    });
    return unsubscribe;
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
      signIn: (email, password) => signInWithEmailAndPassword(auth, email.trim(), password),
      signUp: (email, password) => createUserWithEmailAndPassword(auth, email.trim(), password),
      signOut: async () => {
        clearCachesOnSignOut();
        await firebaseSignOut(auth);
      },
    }),
    [user, isLoading, clearCachesOnSignOut],
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
