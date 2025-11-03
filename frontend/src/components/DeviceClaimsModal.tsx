import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  claimDevice,
  deleteDeviceClaim,
  listDeviceClaims,
  type ClaimDeviceResponse,
  type DeviceSummary,
} from "../lib/api";

type DeviceClaimsModalProps = {
  onClaimsUpdated?: () => void;
};

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return value;
  return new Date(ts).toLocaleString();
}

export function DeviceClaimsModal({ onClaimsUpdated }: DeviceClaimsModalProps) {
  const { status, user, login, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [claims, setClaims] = useState<DeviceSummary[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);

  const [passphrase, setPassphrase] = useState("");
  const [claimPending, setClaimPending] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAuthenticated = status === "authenticated" && Boolean(user);

  const resetActionMessages = useCallback(() => {
    setClaimError(null);
    setClaimSuccess(null);
  }, []);

  const loadClaims = useCallback(async () => {
    if (!isAuthenticated) {
      setClaims([]);
      return;
    }
    setClaimsLoading(true);
    setClaimsError(null);
    try {
      const list = await listDeviceClaims();
      setClaims(list);
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load claim history";
      setClaimsError(message);
    }
    finally {
      setClaimsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (open && isAuthenticated) {
      void loadClaims();
    }
    if (!open) {
      resetActionMessages();
      setClaimsError(null);
    }
  }, [open, isAuthenticated, loadClaims, resetActionMessages]);

  useEffect(() => {
    if (!isAuthenticated) {
      setClaims([]);
    } else if (open) {
      void loadClaims();
    }
  }, [isAuthenticated, open, loadClaims]);

  const handleLogin = useCallback(async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    if (!email.trim() || !password) {
      setLoginError("Email and password are required");
      return;
    }
    setLoginError(null);
    setLoginPending(true);
    try {
      await login(email.trim(), password);
      setPassword("");
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setLoginError(message);
    }
    finally {
      setLoginPending(false);
    }
  }, [email, password, login]);

  const handleLogout = useCallback(async () => {
    resetActionMessages();
    await logout();
    setClaims([]);
  }, [logout, resetActionMessages]);

  const handleClaimSubmit = useCallback(async (evt: FormEvent<HTMLFormElement>) => {
    evt.preventDefault();
    resetActionMessages();
    const trimmed = passphrase.trim();
    if (!trimmed) {
      setClaimError("Passphrase is required");
      return;
    }
    setClaimPending(true);
    try {
      const result: ClaimDeviceResponse = await claimDevice(trimmed);
      setPassphrase("");
      const displayId = result.device?.id ?? result.deviceId;
      setClaimSuccess(`Device ${displayId} claimed successfully.`);
      await loadClaims();
      onClaimsUpdated?.();
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Unable to claim device";
      setClaimError(message);
    }
    finally {
      setClaimPending(false);
    }
  }, [passphrase, loadClaims, onClaimsUpdated, resetActionMessages]);

  const handleDelete = useCallback(async (deviceId: string) => {
    resetActionMessages();
    setDeletingId(deviceId);
    try {
      await deleteDeviceClaim(deviceId);
      setClaimSuccess(`Claim for device ${deviceId} removed.`);
      await loadClaims();
      onClaimsUpdated?.();
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Unable to delete claim";
      setClaimError(message);
    }
    finally {
      setDeletingId(null);
    }
  }, [loadClaims, onClaimsUpdated, resetActionMessages]);

  const loginSection = useMemo(() => (
    <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(evt) => setEmail(evt.target.value)}
          required
          style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #ccc" }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(evt) => setPassword(evt.target.value)}
          required
          style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #ccc" }}
        />
      </label>
      {loginError ? <p style={{ color: "#b00020", margin: 0 }}>{loginError}</p> : null}
      <button
        type="submit"
        disabled={loginPending}
        style={{ padding: "8px 12px", borderRadius: 4, border: "none", background: "#1d4ed8", color: "#fff", cursor: "pointer", opacity: loginPending ? 0.7 : 1 }}
      >
        {loginPending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  ), [email, password, loginError, loginPending, handleLogin]);

  const claimsSection = useMemo(() => {
    if (!isAuthenticated) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 14, color: "#555" }}>Signed in as</div>
            <div style={{ fontWeight: 600 }}>{user?.email ?? user?.uid}</div>
          </div>
          <button
            type="button"
            onClick={() => { void handleLogout(); }}
            style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
          >
            Sign out
          </button>
        </div>

        <form onSubmit={handleClaimSubmit} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8, background: "#f9fafb" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span>Device passphrase</span>
            <input
              type="text"
              value={passphrase}
              onChange={(evt) => setPassphrase(evt.target.value)}
              placeholder="Enter device passphrase"
              style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid #cbd5f5" }}
            />
          </label>
          {claimError ? <p style={{ color: "#b00020", margin: 0 }}>{claimError}</p> : null}
          {claimSuccess ? <p style={{ color: "#047857", margin: 0 }}>{claimSuccess}</p> : null}
          <button
            type="submit"
            disabled={claimPending}
            style={{ padding: "8px 12px", borderRadius: 4, border: "none", background: "#2563eb", color: "#fff", cursor: "pointer", opacity: claimPending ? 0.7 : 1 }}
          >
            {claimPending ? "Submitting…" : "Submit claim"}
          </button>
        </form>

        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Claim log</h3>
          </div>
          {claimsError ? <p style={{ color: "#b00020", margin: 0 }}>{claimsError}</p> : null}
          {claimsLoading ? <p style={{ margin: 0 }}>Loading…</p> : null}
          {!claimsLoading && !claimsError && claims.length === 0 ? (
            <p style={{ margin: 0, color: "#6b7280" }}>No device claims yet.</p>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {claims.map((claim) => (
              <div key={claim.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{claim.name || claim.id}</div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Claimed {formatDate(claim.claimedAt)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => { void handleDelete(claim.id); }}
                  disabled={deletingId === claim.id}
                  style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #ef4444", background: "#fef2f2", color: "#b91c1c", cursor: "pointer", opacity: deletingId === claim.id ? 0.6 : 1 }}
                >
                  {deletingId === claim.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }, [
    isAuthenticated,
    user,
    claims,
    claimsError,
    claimsLoading,
    passphrase,
    claimError,
    claimSuccess,
    claimPending,
    deletingId,
    handleClaimSubmit,
    handleDelete,
    handleLogout,
  ]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          style={{ padding: "6px 10px", borderRadius: 4, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
        >
          Manage Device Claims
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)" }} />
        <Dialog.Content
          style={{
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 20px 45px rgba(15, 23, 42, 0.25)",
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(640px, 90vw)",
            maxHeight: "80vh",
            overflowY: "auto",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Dialog.Title style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Device Claims</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer", lineHeight: 1 }}
              >
                ×
              </button>
            </Dialog.Close>
          </div>
          {isAuthenticated ? claimsSection : loginSection}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
