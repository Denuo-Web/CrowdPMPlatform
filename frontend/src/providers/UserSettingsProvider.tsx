import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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

async function loadUserSettingsApi() {
  const { fetchUserSettings, updateUserSettings } = await import("../lib/api");
  return { fetchUserSettings, updateUserSettings };
}

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setSettings(DEFAULT_USER_SETTINGS);
      setError(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { fetchUserSettings } = await loadUserSettingsApi();
      const next = await fetchUserSettings();
      setSettings(applyUserSettingsDefaults(next));
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load user settings";
      setError(message);
      setSettings(DEFAULT_USER_SETTINGS);
    }
    finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateSettingsHandler = useCallback(async (next: Partial<UserSettings>) => {
    if (!user) throw new Error("Sign in is required to update settings.");
    setIsSaving(true);
    setError(null);
    try {
      const { updateUserSettings } = await loadUserSettingsApi();
      const updated = await updateUserSettings(next);
      const normalized = applyUserSettingsDefaults(updated);
      setSettings(normalized);
      return normalized;
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update settings";
      setError(message);
      throw err;
    }
    finally {
      setIsSaving(false);
    }
  }, [user]);

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
