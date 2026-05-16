import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { UserThemeSettings } from "@crowdpm/types";
import { Button, Callout, Dialog, Flex, Text } from "@radix-ui/themes";
import { confirmThemeSaveCheckoutSession, createThemeSaveCheckoutSession } from "../lib/api";
import { LegalDocumentDialog, LegalDocumentLink, type LegalDocumentId } from "./LegalDocumentDialog";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";

const ThemeSettingsControls = lazy(async () => {
  const module = await import("./ThemeSettingsControls");
  return { default: module.ThemeSettingsControls };
});

export type ThemeCheckoutNotice = "success" | "cancelled" | null;

type ThemePreferencesModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  checkoutNotice: ThemeCheckoutNotice;
  checkoutSessionId: string | null;
  theme: UserThemeSettings;
  onThemeChange: (next: UserThemeSettings) => void;
  onThemeSaved: () => void;
};

export function ThemePreferencesModal({
  open,
  onOpenChange,
  checkoutNotice,
  checkoutSessionId,
  theme,
  onThemeChange,
  onThemeSaved,
}: ThemePreferencesModalProps) {
  const { user } = useAuth();
  const { settings, refresh, isLoading, isSaving, updateSettings } = useUserSettings();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [isConfirmingCheckout, setIsConfirmingCheckout] = useState(false);
  const [openLegalDocument, setOpenLegalDocument] = useState<LegalDocumentId | null>(null);
  const confirmationAttemptKeyRef = useRef<string | null>(null);
  const controlsDisabled = isLoading || isSaving || isStartingCheckout || isConfirmingCheckout;
  const hasUnsavedChanges = JSON.stringify(theme) !== JSON.stringify(settings.theme);
  const saveDisabled = controlsDisabled || !user || !settings.themeSaveUnlocked || !hasUnsavedChanges;
  const unlockDisabled = controlsDisabled || !user || settings.themeSaveUnlocked;
  const checkoutNoticeMessage = !open
    ? null
    : checkoutNotice === "success"
      ? (settings.themeSaveUnlocked
        ? "Theme saving is now unlocked for this account."
        : "Theme purchase completed. If saving is still locked, give the account a moment to refresh.")
      : checkoutNotice === "cancelled"
        ? "Theme save unlock checkout was cancelled before payment completed."
        : null;
  const message = actionMessage ?? checkoutNoticeMessage;

  const handleDialogOpenChange = useCallback((next: boolean) => {
    if (!next) {
      setActionMessage(null);
      setError(null);
      setIsStartingCheckout(false);
      setIsConfirmingCheckout(false);
      setOpenLegalDocument(null);
    }
    onOpenChange(next);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || checkoutNotice !== "success" || !user) {
      return;
    }
    const confirmationKey = `${user.uid}:${checkoutSessionId ?? "none"}`;
    if (confirmationAttemptKeyRef.current === confirmationKey) {
      return;
    }
    confirmationAttemptKeyRef.current = confirmationKey;
    let isCancelled = false;

    void (async () => {
      try {
        setActionMessage(null);
        setError(null);
        setIsConfirmingCheckout(true);
        if (checkoutSessionId) {
          await confirmThemeSaveCheckoutSession(checkoutSessionId);
        }
        await refresh();
      }
      catch (err) {
        if (isCancelled) return;
        if (err instanceof Error && err.message === "theme_save_pending") {
          setError("Theme purchase is still processing. Please try again in a moment.");
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to refresh theme entitlements.");
      }
      finally {
        if (!isCancelled) {
          setIsConfirmingCheckout(false);
        }
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [checkoutNotice, checkoutSessionId, open, refresh, user]);

  const handleSave = async () => {
    if (!user) {
      setActionMessage(null);
      setError("Sign in to save theme preferences.");
      return;
    }
    if (!settings.themeSaveUnlocked) {
      setActionMessage(null);
      setError("Purchase the theme save unlock to persist theme preferences.");
      return;
    }
    if (!hasUnsavedChanges) {
      setActionMessage("No theme changes to save.");
      setError(null);
      return;
    }

    setActionMessage(null);
    setError(null);
    try {
      await updateSettings({ theme });
      onThemeSaved();
      setActionMessage("Theme preferences saved.");
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update theme preferences.");
    }
  };

  const handlePurchaseThemeSave = async () => {
    if (!user) {
      setActionMessage(null);
      setError("Sign in to purchase and save theme preferences.");
      return;
    }

    setActionMessage(null);
    setError(null);
    setIsStartingCheckout(true);
    try {
      const session = await createThemeSaveCheckoutSession();
      window.location.assign(session.url);
      return;
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open theme checkout right now.");
      setIsStartingCheckout(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleDialogOpenChange}>
      <Dialog.Content
        size="3"
        style={{
          width: "min(460px, 96vw)",
          maxWidth: "460px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <Dialog.Title>Theme</Dialog.Title>
        <Dialog.Description>
          Preview changes live, then save them when you are ready.
        </Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          {!user ? (
            <Callout.Root color="amber" variant="surface">
              <Callout.Text>
                Sign in to purchase the theme save unlock and save theme preferences to your account.
              </Callout.Text>
            </Callout.Root>
          ) : !settings.themeSaveUnlocked ? (
            <Callout.Root color="amber" variant="surface">
              <Callout.Text>
                Theme saving is locked for this account. Live preview stays available, but saving
                requires a one-time $3 theme save unlock.
              </Callout.Text>
            </Callout.Root>
          ) : (
            <Callout.Root color="green" variant="surface">
              <Callout.Text>
                Theme saving is unlocked for this account.
              </Callout.Text>
            </Callout.Root>
          )}

          {open ? (
            <Suspense fallback={<Text size="2" color="gray">Loading theme settings...</Text>}>
              <ThemeSettingsControls
                value={theme}
                onChange={onThemeChange}
                disabled={controlsDisabled}
              />
            </Suspense>
          ) : null}

          {!settings.themeSaveUnlocked ? (
            <Flex direction="column" gap="2">
              <Button
                size="3"
                variant="solid"
                onClick={() => { void handlePurchaseThemeSave(); }}
                disabled={unlockDisabled}
              >
                {isStartingCheckout ? "Opening Checkout..." : "Unlock Theme Saving - $3"}
              </Button>
              <Text size="1" color="gray">
                Sold by Denuo Web LLC as a one-time digital expansion purchase. No shipping applies,
                applicable sales tax is calculated in Stripe Checkout, and theme save unlock purchases
                are subject to the{" "}
                <LegalDocumentLink documentId="terms" onOpen={setOpenLegalDocument}>
                  Terms
                </LegalDocumentLink>
                ,{" "}
                <LegalDocumentLink documentId="license" onOpen={setOpenLegalDocument}>
                  License
                </LegalDocumentLink>
                , and{" "}
                <LegalDocumentLink documentId="privacy" onOpen={setOpenLegalDocument}>
                  Privacy Policy
                </LegalDocumentLink>
                .
              </Text>
            </Flex>
          ) : null}

          <Flex justify="end" gap="3" mt="2">
            <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={() => { void handleSave(); }} disabled={saveDisabled}>
              Save
            </Button>
          </Flex>
        </Flex>
        {error ? (
          <Text color="tomato" size="2" mt="3">{error}</Text>
        ) : null}
        {message ? (
          <Text color="green" size="2" mt="3">{message}</Text>
        ) : null}
      </Dialog.Content>
      <LegalDocumentDialog
        documentId={openLegalDocument}
        onOpenChange={(next) => {
          if (!next) setOpenLegalDocument(null);
        }}
      />
    </Dialog.Root>
  );
}
