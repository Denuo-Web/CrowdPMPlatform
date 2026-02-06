import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Callout, Card, Flex, Heading, Separator, Text, TextField } from "@radix-ui/themes";
import { timestampToMillis } from "@crowdpm/types";
import { useAuth } from "../providers/AuthProvider";
import { AuthDialog, type AuthMode } from "../components/AuthDialog";
import {
  authorizeActivationSession,
  fetchActivationSession,
  type ActivationSession,
} from "../lib/api";

type ActivationPageProps = {
  layout?: "standalone" | "dialog";
};

function getInitialCode(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("code") ?? "";
  }
  catch {
    return "";
  }
}

function updateQueryParam(code: string) {
  try {
    const url = new URL(window.location.href);
    if (code) {
      url.searchParams.set("code", code);
    }
    else {
      url.searchParams.delete("code");
    }
    window.history.replaceState({}, "", url.toString());
  }
  catch {
    // ignore
  }
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function ActivationPage({ layout = "standalone" }: ActivationPageProps = {}) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");

  const [userCode, setUserCode] = useState(() => getInitialCode());
  const [session, setSession] = useState<ActivationSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const initialCodeRef = useRef(userCode.trim());
  const hasAutoLookupRef = useRef(false);

  useEffect(() => {
    if (!user && !authDialogOpen) {
      setAuthMode("login");
      setAuthDialogOpen(true);
    }
  }, [user, authDialogOpen]);

  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session]);

  const remaining = useMemo(() => {
    if (!session) return null;
    const expires = timestampToMillis(session.expires_at);
    if (expires === null) return null;
    return Math.max(0, expires - now);
  }, [session, now]);

  const handleLookup = useCallback(async () => {
    if (!userCode.trim()) {
      setError("Enter the user code displayed on your node.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setStatusMessage(null);
    try {
      updateQueryParam(userCode.trim());
      const result = await fetchActivationSession(userCode.trim());
      setSession(result);
    }
    catch (err) {
      setSession(null);
      setError(err instanceof Error ? err.message : "Unable to load pairing session.");
    }
    finally {
      setIsLoading(false);
    }
  }, [userCode]);

  const matchesInitialCode = useMemo(() => {
    return initialCodeRef.current.length > 0 && initialCodeRef.current === userCode.trim();
  }, [userCode]);

  useEffect(() => {
    if (!user || !matchesInitialCode || session || isLoading || hasAutoLookupRef.current) return;
    hasAutoLookupRef.current = true;
    void handleLookup();
  }, [user, matchesInitialCode, session, isLoading, handleLookup]);

  const handleAuthorize = useCallback(async () => {
    if (!session) return;
    setIsAuthorizing(true);
    setStatusMessage(null);
    setError(null);
    try {
      const result = await authorizeActivationSession(session.user_code);
      setSession(result);
      setStatusMessage("Device approved. The node can continue the pairing flow.");
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Unable to authorize this device.");
    }
    finally {
      setIsAuthorizing(false);
    }
  }, [session]);

  const isAuthorized = session?.status?.toLowerCase() === "authorized";
  const deepLink = useMemo(() => {
    if (!session) return null;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("code", session.user_code);
      return url.toString();
    }
    catch {
      return null;
    }
  }, [session]);

  const requestedAtLabel = useMemo(() => {
    const requestedAtMs = session ? timestampToMillis(session.requested_at) : null;
    return requestedAtMs === null ? "—" : new Date(requestedAtMs).toLocaleString();
  }, [session]);

  return (
    <Flex
      direction="column"
      gap="5"
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: layout === "dialog" ? "var(--space-5)" : "var(--space-6) var(--space-5)",
        backgroundColor: layout === "dialog" ? "transparent" : "var(--color-panel-solid)",
        color: "var(--color-panel-contrast)",
        borderRadius: layout === "dialog" ? undefined : "var(--radius-4)",
      }}
    >
      <Box>
        <Heading as="h1" size="8">Pair a node</Heading>
        <Text color="gray">
          Enter the <strong>user code</strong> displayed on your device to review its metadata and approve pairing.
          If your account has 2FA enabled, completing a fresh MFA challenge is required before authorizing.
        </Text>
      </Box>

      <Card>
        <Flex direction="column" gap="3">
          <Text size="2" color="gray">User code</Text>
          <TextField.Root
            value={userCode}
            onChange={(event) => setUserCode(event.target.value.toUpperCase())}
            placeholder="ABCD-EFGH-J"
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            required
          />
          <Flex gap="3" wrap="wrap">
            <Button onClick={handleLookup} disabled={isLoading}>
              {isLoading ? "Looking up…" : "Load device"}
            </Button>
            {!user ? (
              <Button variant="soft" onClick={() => setAuthDialogOpen(true)} disabled={isAuthLoading}>
                {isAuthLoading ? "Checking account…" : "Sign in"}
              </Button>
            ) : (
              <Text size="2" color="gray">
                Signed in as <strong>{user.email ?? user.uid}</strong>
              </Text>
            )}
          </Flex>
          {error ? (
            <Callout.Root color="tomato">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          ) : null}
          {statusMessage ? (
            <Callout.Root color="green">
              <Callout.Text>{statusMessage}</Callout.Text>
            </Callout.Root>
          ) : null}
        </Flex>
      </Card>

      {session ? (
        <Card>
          <Flex direction="column" gap="3">
            <Heading as="h2" size="5">Pending device</Heading>
            <Text color="gray">Verify these facts match the hardware in your possession.</Text>
            <Separator my="3" />
            <Flex direction={{ initial: "column", sm: "row" }} gap="4">
              <Box>
                <Text size="2" color="gray">Model</Text>
                <Text weight="medium">{session.model}</Text>
              </Box>
              <Box>
                <Text size="2" color="gray">Firmware</Text>
                <Text weight="medium">{session.version}</Text>
              </Box>
              <Box>
                <Text size="2" color="gray">Fingerprint</Text>
                <Text weight="medium" style={{ fontFamily: "monospace" }}>{session.fingerprint}</Text>
              </Box>
            </Flex>
            <Flex direction={{ initial: "column", sm: "row" }} gap="4">
              <Box>
                <Text size="2" color="gray">Requested</Text>
                <Text weight="medium">{requestedAtLabel}</Text>
              </Box>
              <Box>
                <Text size="2" color="gray">Expires in</Text>
                <Text weight="medium">{remaining !== null ? formatDuration(remaining) : "—"}</Text>
              </Box>
            </Flex>
            <Flex direction={{ initial: "column", sm: "row" }} gap="4">
              <Box>
                <Text size="2" color="gray">Coarse IP</Text>
                <Text weight="medium">{session.requester_ip || "Unavailable"}</Text>
              </Box>
              <Box>
                <Text size="2" color="gray">Network / ASN</Text>
                <Text weight="medium">{session.requester_asn || "Unavailable"}</Text>
              </Box>
            </Flex>
            {deepLink ? (
              <Box>
                <Text size="2" color="gray">Deep link</Text>
                <Text asChild weight="medium" size="2">
                  <a href={deepLink}>{deepLink}</a>
                </Text>
              </Box>
            ) : null}

            <Separator my="3" />
            {isAuthorized ? (
              <Callout.Root color="green">
                <Callout.Text>This node is authorized for your account. Return to the device to continue registration.</Callout.Text>
              </Callout.Root>
            ) : (
              <Flex direction="column" gap="3">
                <Text color="gray">
                  Approving links this device to <strong>{user?.email ?? user?.uid ?? "your account"}</strong>.
                </Text>
                <Button onClick={handleAuthorize} disabled={!user || isAuthorizing}>
                  {isAuthorizing ? "Authorizing…" : user ? "Authorize device" : "Sign in to authorize"}
                </Button>
                {!user ? (
                  <Text size="2" color="gray">
                    Sign in first so we know which account to link this device to.
                  </Text>
                ) : null}
              </Flex>
            )}
          </Flex>
        </Card>
      ) : null}

      <AuthDialog
        open={authDialogOpen}
        mode={authMode}
        onModeChange={setAuthMode}
        onOpenChange={setAuthDialogOpen}
        onAuthenticated={() => {
          setAuthDialogOpen(false);
          setStatusMessage("Signed in. You can now authorize the device.");
        }}
      />
    </Flex>
  );
}
