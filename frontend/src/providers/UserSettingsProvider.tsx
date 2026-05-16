import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserSettings } from "../lib/api";
import { useAuth } from "./AuthProvider";

type UserSettingsContextValue = {
  settings: UserSettings;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateSettings: (next: Partial<UserSettings>) => Promise<UserSettings>;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  defaultBatchVisibility: "public",
  interleavedRendering: false,
  theme: {
    appearance: "dark",
    accentColor: "iris",
    grayColor: "auto",
    panelBackground: "translucent",
    radius: "full",
    scaling: "100%",
  },
  themeSaveUnlocked: false,
  subscription: {
    planId: "free_community",
    label: "Free / Community",
    source: "free",
    status: "active",
    billingInterval: null,
    canManageBilling: false,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    videoDownloadAccess: "preview_watermarked",
    limits: {
      maxActiveDevices: 2,
      maxStoredBatchesTotal: 100,
      maxStoredPrivateBatches: 0,
      monthlyPoints: 100_000,
      maxPointsPerBatch: 5_000,
    },
    usage: {
      activeDevices: 0,
      storedBatchesTotal: 0,
      storedPrivateBatches: 0,
      monthlyPointsUsed: 0,
      monthlyPointsRemaining: 100_000,
      monthKey: "1970-01",
      resetAt: "1970-02-01T00:00:00.000Z",
    },
  },
  subscriptionOffers: [],
};

function applyUserSettingsDefaults(next: Partial<UserSettings>): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    ...next,
    theme: {
      ...DEFAULT_USER_SETTINGS.theme,
      ...(next.theme ?? {}),
    },
  };
}

const UserSettingsContext = createContext<UserSettingsContextValue | undefined>(undefined);
const USER_SETTINGS_QUERY_KEY = "userSettings";

async function loadUserSettingsApi() {
  const { fetchUserSettings, updateUserSettings } = await import("../lib/api");
  return { fetchUserSettings, updateUserSettings };
}

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => [USER_SETTINGS_QUERY_KEY, user?.uid ?? "anon"], [user?.uid]);

  const settingsQuery = useQuery({
    queryKey,
    enabled: Boolean(user),
    queryFn: async () => {
      const { fetchUserSettings } = await loadUserSettingsApi();
      const next = await fetchUserSettings();
      return applyUserSettingsDefaults(next);
    },
    placeholderData: DEFAULT_USER_SETTINGS,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (next: Partial<UserSettings>) => {
      if (!user) throw new Error("Sign in is required to update settings.");
      const { updateUserSettings } = await loadUserSettingsApi();
      const updated = await updateUserSettings(next);
      return applyUserSettingsDefaults(updated);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
    },
  });

  const refresh = useCallback(async () => {
    if (!user) return;
    await settingsQuery.refetch();
  }, [settingsQuery, user]);

  const updateSettingsHandler = useCallback(async (next: Partial<UserSettings>) => {
    return updateSettingsMutation.mutateAsync(next);
  }, [updateSettingsMutation]);

  const settings = user ? settingsQuery.data ?? DEFAULT_USER_SETTINGS : DEFAULT_USER_SETTINGS;
  const queryError = settingsQuery.error instanceof Error ? settingsQuery.error.message : null;
  const mutationError = updateSettingsMutation.error instanceof Error ? updateSettingsMutation.error.message : null;
  const error = mutationError ?? queryError;
  const isLoading = Boolean(user) && settingsQuery.isLoading;
  const isSaving = updateSettingsMutation.isPending;

  const value = useMemo<UserSettingsContextValue>(() => ({
    settings,
    isLoading,
    isSaving,
    error,
    refresh,
    updateSettings: updateSettingsHandler,
  }), [settings, isLoading, isSaving, error, refresh, updateSettingsHandler]);

  return (
    <UserSettingsContext.Provider value={value}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings(): UserSettingsContextValue {
  const context = useContext(UserSettingsContext);
  if (!context) {
    throw new Error("useUserSettings must be used within a UserSettingsProvider");
  }
  return context;
}
