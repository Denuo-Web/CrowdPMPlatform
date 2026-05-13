import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Callout, Card, Flex, Heading, Link, SegmentedControl, Select, Separator, Switch, Table, Text, TextField } from "@radix-ui/themes";
import { ReloadIcon } from "@radix-ui/react-icons";
import { timestampToMillis } from "@crowdpm/types";
import { InternalNewTabAnchor } from "../components/InternalLink";
import {
  confirmSubscriptionCheckoutSession,
  createBillingPortalSession,
  createSubscriptionCheckoutSession,
  deleteBatch,
  listBatches,
  listDevices,
  listNodePurchaseReceipts,
  revokeDevice,
  updateBatchVisibility,
  type BatchSummary,
  type BatchVisibility,
  type DeviceSummary,
  type NodePurchaseReceipt,
} from "../lib/api";
import { APP_ROUTES } from "../lib/appRoutes";
import { logError } from "../lib/logger";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";
import { buildActivationLink } from "../lib/activation";
import { clampPageIndex, getPaginationWindow, ResultCountControl } from "../components/PaginationControl";

type UserDashboardProps = {
  onRequestActivation: () => void;
  onOpenSmokeTest?: () => void;
  onOpenThemeModal: () => void;
  subscriptionCheckoutNotice?: "success" | "cancelled" | null;
  subscriptionCheckoutSessionId?: string | null;
  onSubscriptionCheckoutHandled?: () => void;
  refreshToken?: number;
};

function describeStatus(status?: string | null): { label: string; tone: "green" | "yellow" | "red" | "gray" } {
  const normalized = (status ?? "").toLowerCase();
  if (["active", "ok", "ready"].includes(normalized)) return { label: "Active", tone: "green" };
  if (["pending", "provisioning"].includes(normalized)) return { label: "Provisioning", tone: "yellow" };
  if (!normalized) return { label: "Unknown", tone: "gray" };
  return { label: status ?? "Unknown", tone: "red" };
}

function formatReceiptMoney(cents: number | null, currency: string | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

function formatReceiptDate(value: string | null): string {
  if (!value) return "—";
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? "—" : new Date(millis).toLocaleString();
}

function formatShippingLocation(receipt: NodePurchaseReceipt): string {
  const address = receipt.shippingAddress;
  const city = address?.city?.trim();
  const state = address?.state?.trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || "—";
}

export default function UserDashboard({
  onRequestActivation,
  onOpenSmokeTest,
  onOpenThemeModal,
  subscriptionCheckoutNotice = null,
  subscriptionCheckoutSessionId = null,
  onSubscriptionCheckoutHandled,
  refreshToken = 0,
}: UserDashboardProps) {
  const { user } = useAuth();
  const { settings, isLoading: isSettingsLoading, isSaving: isSettingsSaving, error: settingsError, refresh, updateSettings } = useUserSettings();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [devicePageIndex, setDevicePageIndex] = useState(0);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [selectedBatchDeviceId, setSelectedBatchDeviceId] = useState<string>("all");
  const [batchActionError, setBatchActionError] = useState<string | null>(null);
  const [batchActionMessage, setBatchActionMessage] = useState<string | null>(null);
  const [updatingBatchKey, setUpdatingBatchKey] = useState<string | null>(null);
  const [deletingBatchKey, setDeletingBatchKey] = useState<string | null>(null);
  const [batchPageIndex, setBatchPageIndex] = useState(0);
  const [receipts, setReceipts] = useState<NodePurchaseReceipt[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState(false);
  const [receiptsError, setReceiptsError] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsLocalError, setSettingsLocalError] = useState<string | null>(null);
  const [subscriptionMessage, setSubscriptionMessage] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [activeCheckoutOfferId, setActiveCheckoutOfferId] = useState<"pro_monthly" | "pro_yearly" | null>(null);
  const [isOpeningBillingPortal, setOpeningBillingPortal] = useState(false);
  const activationUrl = useMemo(() => buildActivationLink(), []);
  const [activationLinkMessage, setActivationLinkMessage] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!user) {
      setDevices([]);
      setDevicesError(null);
      return;
    }
    setIsLoadingDevices(true);
    setDevicesError(null);
    try {
      const next = await listDevices();
      setDevices(next);
    }
    catch (err) {
      setDevices([]);
      setDevicesError(err instanceof Error ? err.message : "Unable to load devices");
    }
    finally {
      setIsLoadingDevices(false);
    }
  }, [user]);

  const refreshBatches = useCallback(async () => {
    if (!user) {
      setBatches([]);
      setBatchesError(null);
      return;
    }
    setIsLoadingBatches(true);
    setBatchesError(null);
    try {
      const next = await listBatches();
      setBatches(next);
    }
    catch (err) {
      setBatches([]);
      setBatchesError(err instanceof Error ? err.message : "Unable to load batches");
    }
    finally {
      setIsLoadingBatches(false);
    }
  }, [user]);

  const refreshReceipts = useCallback(async () => {
    if (!user) {
      setReceipts([]);
      setReceiptsError(null);
      return;
    }
    setIsLoadingReceipts(true);
    setReceiptsError(null);
    try {
      const next = await listNodePurchaseReceipts();
      setReceipts(next);
    }
    catch (err) {
      setReceipts([]);
      setReceiptsError(err instanceof Error ? err.message : "Unable to load hardware receipts");
    }
    finally {
      setIsLoadingReceipts(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshDevices();
    void refreshBatches();
    void refreshReceipts();
  }, [refreshBatches, refreshDevices, refreshReceipts, refreshToken]);

  useEffect(() => {
    if (!user || !subscriptionCheckoutNotice) {
      return;
    }
    let cancelled = false;

    setSubscriptionError(null);
    setSubscriptionMessage(
      subscriptionCheckoutNotice === "cancelled"
        ? "Subscription checkout was cancelled before it completed."
        : "Subscription checkout completed. Refreshing account access…"
    );

    void (async () => {
      try {
        if (subscriptionCheckoutNotice === "success" && subscriptionCheckoutSessionId) {
          await confirmSubscriptionCheckoutSession(subscriptionCheckoutSessionId);
        }
        await Promise.all([refresh(), refreshDevices(), refreshBatches()]);
        if (!cancelled && subscriptionCheckoutNotice === "success") {
          setSubscriptionMessage("Subscription access is now active for this account.");
        }
      }
      catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unable to refresh subscription access right now.";
        if (subscriptionCheckoutNotice === "success") {
          setSubscriptionError(message);
        }
      }
      finally {
        if (!cancelled) {
          onSubscriptionCheckoutHandled?.();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    onSubscriptionCheckoutHandled,
    refresh,
    refreshBatches,
    refreshDevices,
    subscriptionCheckoutNotice,
    subscriptionCheckoutSessionId,
    user,
  ]);

  const ownedCount = useMemo(() => devices.length, [devices]);
  const completedReceiptCount = useMemo(() => receipts.length, [receipts.length]);
  const activeCount = useMemo(
    () => devices.filter((device) => describeStatus(device.registryStatus ?? device.status).tone === "green").length,
    [devices],
  );
  const isSettingsBusy = isSettingsLoading || isSettingsSaving;
  const subscription = settings.subscription;
  const subscriptionOffers = settings.subscriptionOffers;
  const checkoutOffers = subscriptionOffers.filter((offer) => offer.action === "checkout");
  const researchOffer = subscriptionOffers.find((offer) => offer.offerId === "research_contact") ?? null;
  const deviceNameLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const device of devices) {
      lookup.set(device.id, device.name?.trim().length ? device.name : device.id);
    }
    return lookup;
  }, [devices]);
  const batchDeviceOptions = useMemo(() => {
    const uniqueDeviceIds = new Set<string>([
      ...devices.map((device) => device.id),
      ...batches.map((batch) => batch.deviceId),
    ]);
    return Array.from(uniqueDeviceIds)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({
        id,
        label: deviceNameLookup.get(id) ?? batches.find((batch) => batch.deviceId === id)?.deviceName ?? id,
      }));
  }, [batches, deviceNameLookup, devices]);
  const filteredBatches = useMemo(() => {
    const byDevice = selectedBatchDeviceId === "all"
      ? batches
      : batches.filter((batch) => batch.deviceId === selectedBatchDeviceId);
    return [...byDevice].sort((a, b) => {
      const timeA = timestampToMillis(a.processedAt) ?? 0;
      const timeB = timestampToMillis(b.processedAt) ?? 0;
      return timeB - timeA;
    });
  }, [batches, selectedBatchDeviceId]);
  const devicePagination = useMemo(
    () => getPaginationWindow(devices.length, devicePageIndex),
    [devicePageIndex, devices.length],
  );
  const visibleDevices = useMemo(
    () => devices.slice(devicePagination.pageStart, devicePagination.pageEnd),
    [devicePagination.pageEnd, devicePagination.pageStart, devices],
  );
  const batchPagination = useMemo(
    () => getPaginationWindow(filteredBatches.length, batchPageIndex),
    [batchPageIndex, filteredBatches.length],
  );
  const visibleBatches = useMemo(
    () => filteredBatches.slice(batchPagination.pageStart, batchPagination.pageEnd),
    [batchPagination.pageEnd, batchPagination.pageStart, filteredBatches],
  );

  useEffect(() => {
    if (selectedBatchDeviceId === "all") return;
    const stillExists = batchDeviceOptions.some((option) => option.id === selectedBatchDeviceId);
    if (!stillExists) {
      setSelectedBatchDeviceId("all");
    }
  }, [batchDeviceOptions, selectedBatchDeviceId]);

  useEffect(() => {
    const nextPageIndex = clampPageIndex(devices.length, devicePageIndex);
    if (nextPageIndex !== devicePageIndex) {
      setDevicePageIndex(nextPageIndex);
    }
  }, [devicePageIndex, devices.length]);

  useEffect(() => {
    const nextPageIndex = clampPageIndex(filteredBatches.length, batchPageIndex);
    if (nextPageIndex !== batchPageIndex) {
      setBatchPageIndex(nextPageIndex);
    }
  }, [batchPageIndex, filteredBatches.length]);

  const handleDefaultVisibilityChange = useCallback(async (nextValue: string) => {
    const next = nextValue as BatchVisibility;
    if (next === settings.defaultBatchVisibility || !user) return;
    setSettingsLocalError(null);
    setSettingsMessage(null);
    try {
      await updateSettings({ defaultBatchVisibility: next });
      setSettingsMessage(next === "public" ? "Future batches will default to public." : "Future batches will default to private.");
    }
    catch (err) {
      setSettingsLocalError(err instanceof Error ? err.message : "Unable to update user settings.");
    }
  }, [settings.defaultBatchVisibility, updateSettings, user]);

  const handleInterleavedChange = useCallback(async (nextValue: boolean) => {
    if (nextValue === settings.interleavedRendering || !user) return;
    setSettingsLocalError(null);
    setSettingsMessage(null);
    try {
      await updateSettings({ interleavedRendering: nextValue });
      setSettingsMessage(
        nextValue
          ? "Interleaved map rendering enabled. Turn off if you see WebGL errors."
          : "Interleaved map rendering disabled for improved compatibility."
      );
    }
    catch (err) {
      setSettingsLocalError(err instanceof Error ? err.message : "Unable to update user settings.");
    }
  }, [settings.interleavedRendering, updateSettings, user]);

  const handleStartSubscriptionCheckout = useCallback(async (offerId: "pro_monthly" | "pro_yearly") => {
    if (!user) {
      setSubscriptionError("Sign in is required before starting subscription checkout.");
      setSubscriptionMessage(null);
      return;
    }
    setSubscriptionError(null);
    setSubscriptionMessage(null);
    setActiveCheckoutOfferId(offerId);
    try {
      const session = await createSubscriptionCheckoutSession(offerId);
      window.location.assign(session.url);
    }
    catch (err) {
      setSubscriptionError(err instanceof Error ? err.message : "Unable to open subscription checkout.");
      setActiveCheckoutOfferId(null);
    }
  }, [user]);

  const handleOpenBillingPortal = useCallback(async () => {
    setSubscriptionError(null);
    setSubscriptionMessage(null);
    setOpeningBillingPortal(true);
    try {
      const session = await createBillingPortalSession();
      window.location.assign(session.url);
    }
    catch (err) {
      setSubscriptionError(err instanceof Error ? err.message : "Unable to open the billing portal.");
      setOpeningBillingPortal(false);
    }
  }, []);

  const handleRevoke = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    if (!window.confirm("Revoke this device? It will immediately lose access tokens.")) {
      return;
    }
    setRevokeError(null);
    setRevokingId(deviceId);
    try {
      await revokeDevice(deviceId);
      await Promise.all([refreshDevices(), refreshBatches()]);
    }
    catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Unable to revoke device.");
    }
    finally {
      setRevokingId(null);
    }
  }, [refreshBatches, refreshDevices]);

  const handleToggleBatchVisibility = useCallback(async (batch: BatchSummary) => {
    const actionKey = `${batch.deviceId}:${batch.batchId}`;
    const nextVisibility: BatchVisibility = batch.visibility === "public" ? "private" : "public";
    setBatchActionError(null);
    setBatchActionMessage(null);
    setUpdatingBatchKey(actionKey);
    try {
      const updated = await updateBatchVisibility(batch.deviceId, batch.batchId, nextVisibility);
      setBatches((prev) => prev.map((row) => (
        row.deviceId === updated.deviceId && row.batchId === updated.batchId ? updated : row
      )));
      setBatchActionMessage(
        nextVisibility === "public"
          ? `Batch ${batch.batchId} is now public.`
          : `Batch ${batch.batchId} is now private.`
      );
    }
    catch (err) {
      setBatchActionError(err instanceof Error ? err.message : "Unable to update batch visibility.");
    }
    finally {
      setUpdatingBatchKey(null);
    }
  }, []);

  const handleDeleteBatch = useCallback(async (batch: BatchSummary) => {
    if (!window.confirm(`Delete batch ${batch.batchId}? This removes the saved payload and batch metadata.`)) {
      return;
    }
    const actionKey = `${batch.deviceId}:${batch.batchId}`;
    setBatchActionError(null);
    setBatchActionMessage(null);
    setDeletingBatchKey(actionKey);
    try {
      await deleteBatch(batch.deviceId, batch.batchId);
      setBatches((prev) => prev.filter((row) => !(row.deviceId === batch.deviceId && row.batchId === batch.batchId)));
      setBatchActionMessage(`Deleted batch ${batch.batchId}.`);
    }
    catch (err) {
      setBatchActionError(err instanceof Error ? err.message : "Unable to delete batch.");
    }
    finally {
      setDeletingBatchKey(null);
    }
  }, []);

  const handleOpenActivation = useCallback(() => {
    onRequestActivation();
  }, [onRequestActivation]);

  const handleCopyActivationLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(activationUrl);
      setActivationLinkMessage("Activation link copied.");
      setTimeout(() => setActivationLinkMessage(null), 2000);
    }
    catch (err) {
      logError("Unable to copy activation link", { activationUrl }, err);
      setActivationLinkMessage("Unable to copy link.");
    }
  }, [activationUrl]);


  if (!user) {
    return (
      <>
        <Card>
          <Flex direction="column" gap="3">
            <Heading size="4">User Dashboard</Heading>
            <Text color="gray">Sign in to review the devices tied to your account.</Text>
          </Flex>
        </Card>

        <Card>
          <Flex direction="column" gap="3">
            <Heading as="h3" size="4">Add a device</Heading>
            <Text color="gray">
              Plug in your node and wait for it to display a pairing code. Open the activation UI to review the device facts
              and approve it for this account. The node continues once you approve the code.
            </Text>
            <Flex gap="3" wrap="wrap">
              <Button onClick={handleOpenActivation}>Open activation UI</Button>
              <Button variant="ghost" asChild>
                <InternalNewTabAnchor href={APP_ROUTES.activation}>Open in new tab</InternalNewTabAnchor>
              </Button>
            </Flex>
            <Text size="2" color="gray">Share this link with trusted teammates who can approve devices for your org:</Text>
            <Flex gap="2" align="center" wrap="wrap">
              <Box style={{ flex: 1, minWidth: "240px" }}>
                <TextField.Root value={activationUrl} readOnly />
              </Box>
              <Button variant="soft" onClick={handleCopyActivationLink}>Copy link</Button>
            </Flex>
            {activationLinkMessage ? (
              <Text size="1" color="gray">{activationLinkMessage}</Text>
            ) : null}
          </Flex>
      </Card>
    </>
  );
}

  return (
    <Flex direction="column" gap="5">
      <Box>
        <Heading as="h2" size="5">Welcome back, {user.email ?? user.uid}</Heading>
        <Text color="gray">Monitor the devices that are registered to your CrowdPM ingest pipeline.</Text>
      </Box>

      <Card>
        <Flex direction="column" gap="3">
          <Flex direction={{ initial: "column", sm: "row" }} justify="between" align={{ initial: "start", sm: "center" }} gap="3">
            <Box>
              <Heading as="h3" size="4">Subscription</Heading>
              <Text color="gray">Plan limits, billing state, and export access for this account.</Text>
            </Box>
            <Badge color={subscription.planId === "free_community" ? "gray" : "green"} variant="soft">
              {subscription.label}
            </Badge>
          </Flex>
          <Separator my="2" size="4" />
          {subscriptionError ? (
            <Callout.Root color="tomato">
              <Callout.Text>{subscriptionError}</Callout.Text>
            </Callout.Root>
          ) : null}
          {subscriptionMessage ? (
            <Callout.Root color="green">
              <Callout.Text>{subscriptionMessage}</Callout.Text>
            </Callout.Root>
          ) : null}
          <Flex direction={{ initial: "column", sm: "row" }} gap="4" wrap="wrap">
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">Billing</Text>
              <Heading size="6">
                {subscription.billingInterval === "year"
                  ? "Annual"
                  : subscription.billingInterval === "month"
                    ? "Monthly"
                    : "Community"}
              </Heading>
              <Text size="1" color="gray">
                {subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd
                  ? `Cancels at period end on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}.`
                  : subscription.currentPeriodEnd
                    ? `Current period ends ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}.`
                    : "No recurring billing is active."}
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">Devices</Text>
              <Heading size="6">{subscription.usage.activeDevices} / {subscription.limits.maxActiveDevices}</Heading>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">Stored batches</Text>
              <Heading size="6">{subscription.usage.storedBatchesTotal} / {subscription.limits.maxStoredBatchesTotal}</Heading>
              <Text size="1" color="gray">
                Private: {subscription.usage.storedPrivateBatches} / {subscription.limits.maxStoredPrivateBatches}
              </Text>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">Monthly points</Text>
              <Heading size="6">{subscription.usage.monthlyPointsUsed.toLocaleString()} / {subscription.limits.monthlyPoints.toLocaleString()}</Heading>
              <Text size="1" color="gray">
                Resets {new Date(subscription.usage.resetAt).toLocaleDateString()} · max {subscription.limits.maxPointsPerBatch.toLocaleString()} points per batch
              </Text>
            </Flex>
          </Flex>
          <Text size="2" color="gray">
            Video downloads: {subscription.videoDownloadAccess === "full" ? "full export included" : "watermarked preview export only"}.
          </Text>
          <Flex gap="2" wrap="wrap">
            {checkoutOffers.map((offer) => {
              const isBusy = activeCheckoutOfferId === offer.offerId;
              const offerLabel = offer.billingInterval === "year"
                ? `${offer.label} - ${formatReceiptMoney(offer.unitAmount, offer.currency)} / year`
                : `${offer.label} - ${formatReceiptMoney(offer.unitAmount, offer.currency)} / month`;
              return (
                <Button
                  key={offer.offerId}
                  onClick={() => void handleStartSubscriptionCheckout(offer.offerId as "pro_monthly" | "pro_yearly")}
                  disabled={Boolean(activeCheckoutOfferId) || subscription.planId !== "free_community"}
                >
                  {isBusy ? "Opening Checkout..." : offerLabel}
                </Button>
              );
            })}
            {subscription.canManageBilling ? (
              <Button
                variant="soft"
                onClick={() => void handleOpenBillingPortal()}
                disabled={isOpeningBillingPortal}
              >
                {isOpeningBillingPortal ? "Opening Billing..." : "Manage billing"}
              </Button>
            ) : null}
            {researchOffer ? (
              <Button variant="ghost" asChild>
                <Link href={`mailto:${researchOffer.contactEmail}`}>Contact for Research / Lab</Link>
              </Button>
            ) : null}
          </Flex>
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h3" size="4">Add a device</Heading>
          <Text color="gray">
            Plug in your node, wait for the pairing code to appear, and open the activation UI to approve the request.
          </Text>
          <Flex gap="3" align="center" wrap="wrap">
            <Button onClick={handleOpenActivation}>
              Open activation UI
            </Button>
            <Button variant="ghost" asChild>
              <InternalNewTabAnchor href={APP_ROUTES.pairingGuide}>How does pairing work?</InternalNewTabAnchor>
            </Button>
          </Flex>
          {onOpenSmokeTest ? (
            <Text size="2" color="gray">
              Authorized test users can also{" "}
              <Link
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onOpenSmokeTest();
                }}
              >
                open the Smoke Test Lab
              </Link>
              {" "}from here.
            </Text>
          ) : null}
        </Flex>
      </Card>

      <Card>
        <Flex direction={{ initial: "column", sm: "row" }} justify="between" align="center" gap="4">
          <Flex gap="4">
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">Owned devices</Text>
              <Heading size="6">{ownedCount}</Heading>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">Active</Text>
              <Heading size="6">{activeCount}</Heading>
            </Flex>
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">Hardware orders</Text>
              <Heading size="6">{completedReceiptCount}</Heading>
            </Flex>
          </Flex>
          <Button
            variant="soft"
            onClick={() => { void Promise.all([refreshDevices(), refreshReceipts()]); }}
            disabled={isLoadingDevices || isLoadingReceipts}
          >
            <ReloadIcon /> {isLoadingDevices || isLoadingReceipts ? "Refreshing" : "Refresh"}
          </Button>
        </Flex>
        {devicesError ? (
          <Text mt="3" color="tomato">{devicesError}</Text>
        ) : null}
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Flex direction={{ initial: "column", sm: "row" }} justify="between" align={{ initial: "start", sm: "center" }} gap="3">
            <Box>
              <Heading as="h3" size="4">Hardware receipts</Heading>
              <Text color="gray">Completed node purchases tied to this signed-in account.</Text>
            </Box>
            <Button variant="soft" onClick={refreshReceipts} disabled={isLoadingReceipts}>
              <ReloadIcon /> {isLoadingReceipts ? "Refreshing" : "Refresh"}
            </Button>
          </Flex>
          <Separator my="2" size="4" />
          {receiptsError ? (
            <Callout.Root color="tomato">
              <Callout.Text>{receiptsError}</Callout.Text>
            </Callout.Root>
          ) : null}
          {receipts.length === 0 ? (
            <Text color="gray" style={{ fontStyle: "italic" }}>
              {isLoadingReceipts ? "Loading receipts…" : "No completed hardware purchases for this account."}
            </Text>
          ) : (
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Configuration</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Qty</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Total</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Ship to</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Payment</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {receipts.map((receipt) => (
                  <Table.Row key={receipt.sessionId}>
                    <Table.Cell>
                      <Flex direction="column" gap="1">
                        <Text>{formatReceiptDate(receipt.completedAt)}</Text>
                        <Text size="1" color="gray" style={{ fontFamily: "monospace" }}>
                          {receipt.sessionId}
                        </Text>
                      </Flex>
                    </Table.Cell>
                    <Table.Cell>{receipt.variantLabel ?? "CrowdPM Node Hardware"}</Table.Cell>
                    <Table.Cell>{receipt.quantity}</Table.Cell>
                    <Table.Cell>
                      <Flex direction="column" gap="1">
                        <Text weight="medium">{formatReceiptMoney(receipt.amountTotal, receipt.currency)}</Text>
                        <Text size="1" color="gray">
                          Tax {formatReceiptMoney(receipt.amountTax, receipt.currency)}
                        </Text>
                      </Flex>
                    </Table.Cell>
                    <Table.Cell>{formatShippingLocation(receipt)}</Table.Cell>
                    <Table.Cell>
                      <Badge color={receipt.paymentStatus === "paid" ? "green" : "gray"} variant="soft">
                        {receipt.paymentStatus ?? "completed"}
                      </Badge>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Flex>
      </Card>

      <Card id="user-settings">
        <Flex direction="column" gap="3">
          <Heading as="h3" size="4">User settings</Heading>
          <Text color="gray">Open the theme modal here on mobile, or press T on desktop.</Text>
          <Flex direction={{ initial: "column", sm: "row" }} align={{ initial: "stretch", sm: "center" }} gap="3">
            <Button variant="soft" onClick={onOpenThemeModal}>Open theme preferences</Button>
            <Text size="1" color="gray">
              Theme choices are still saved to your account when updated in the modal.
            </Text>
          </Flex>
          <Separator my="2" size="4" />
          <Text size="2" color="gray">Default batch visibility</Text>
          <SegmentedControl.Root
            value={settings.defaultBatchVisibility}
            onValueChange={handleDefaultVisibilityChange}
            disabled={isSettingsBusy}
          >
            <SegmentedControl.Item value="public">Public</SegmentedControl.Item>
            <SegmentedControl.Item value="private" disabled={subscription.limits.maxStoredPrivateBatches < 1}>
              Private
            </SegmentedControl.Item>
          </SegmentedControl.Root>
          <Text size="1" color="gray">
            {subscription.limits.maxStoredPrivateBatches < 1
              ? "Community accounts default to public uploads. Upgrade to Pro to keep batches private."
              : "Public batches can be surfaced in shared dashboards, while private batches remain restricted to your account."}
          </Text>
          <Separator my="3" size="4" />
          <Text size="2" color="gray">Map rendering</Text>
          <Flex align="center" gap="3">
            <Switch
              checked={settings.interleavedRendering}
              onCheckedChange={(checked) => { void handleInterleavedChange(checked); }}
              disabled={isSettingsBusy}
            />
            <Text>
              Interleave deck.gl with Google Maps (better blending, but can trigger WebGL issues on some GPUs).
            </Text>
          </Flex>
          <Text size="1" color="gray">
            Turn this off if you encounter WebGL/context errors; turn it on if you prefer single-context rendering.
          </Text>
          {settingsLocalError || settingsError ? (
            <Text color="tomato" size="2">{settingsLocalError || settingsError}</Text>
          ) : null}
          {settingsMessage ? (
            <Text color="green" size="2">{settingsMessage}</Text>
          ) : null}
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Flex direction={{ initial: "column", sm: "row" }} justify="between" align={{ initial: "start", sm: "center" }} gap="3">
            <Box>
              <Heading as="h3" size="4">Registered devices</Heading>
              <Text color="gray">These are exposed by the Functions API via /v1/devices for your account.</Text>
            </Box>
            <ResultCountControl
              itemLabelSingular="device"
              itemLabelPlural="devices"
              pageStart={devicePagination.pageStart}
              pageEnd={devicePagination.pageEnd}
              totalCount={devices.length}
              onShowLess={() => setDevicePageIndex((current) => clampPageIndex(devices.length, current - 1))}
              onShowMore={() => setDevicePageIndex((current) => clampPageIndex(devices.length, current + 1))}
            />
          </Flex>
          <Separator my="2" size="4" />
          {revokeError ? (
            <Callout.Root color="tomato">
              <Callout.Text>{revokeError}</Callout.Text>
            </Callout.Root>
          ) : null}
          {devices.length === 0 ? (
            <Text color="gray" style={{ fontStyle: "italic" }}>
              {isLoadingDevices ? "Loading devices…" : "No devices are currently linked to this account."}
            </Text>
          ) : (
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>ID</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Last seen</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Fingerprint</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {visibleDevices.map((device) => {
                  const status = describeStatus(device.registryStatus ?? device.status);
                  const createdMs = timestampToMillis(device.createdAt);
                  const created = createdMs === null ? "—" : new Date(createdMs).toLocaleDateString();
                  const lastSeenMs = timestampToMillis(device.lastSeenAt);
                  const lastSeen = lastSeenMs === null ? "—" : new Date(lastSeenMs).toLocaleString();
                  return (
                    <Table.Row key={device.id}>
                      <Table.Cell>
                        <Text weight="medium">{device.id}</Text>
                      </Table.Cell>
                      <Table.Cell>{device.name || "Unnamed device"}</Table.Cell>
                      <Table.Cell>
                        <Badge color={status.tone} variant="soft">
                          {status.label}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Flex direction="column">
                          <Text>{lastSeen}</Text>
                          <Text size="1" color="gray">Created {created}</Text>
                        </Flex>
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="2" style={{ fontFamily: "monospace" }}>{device.fingerprint || "—"}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Button
                          variant="soft"
                          size="1"
                          disabled={revokingId === device.id || status.tone !== "green"}
                          onClick={() => handleRevoke(device.id)}
                        >
                          {revokingId === device.id ? "Revoking…" : "Revoke"}
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          )}
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Flex direction={{ initial: "column", sm: "row" }} justify="between" align={{ initial: "start", sm: "center" }} gap="3">
            <Box>
              <Heading as="h3" size="4">Batch uploads</Heading>
              <Text color="gray">Manage uploaded batches for each registered device.</Text>
            </Box>
            <Flex align="center" gap="2" wrap="wrap">
              <ResultCountControl
                itemLabelSingular="batch"
                itemLabelPlural="batches"
                pageStart={batchPagination.pageStart}
                pageEnd={batchPagination.pageEnd}
                totalCount={filteredBatches.length}
                onShowLess={() => setBatchPageIndex((current) => clampPageIndex(filteredBatches.length, current - 1))}
                onShowMore={() => setBatchPageIndex((current) => clampPageIndex(filteredBatches.length, current + 1))}
              />
              <Button variant="soft" onClick={refreshBatches} disabled={isLoadingBatches}>
                <ReloadIcon /> {isLoadingBatches ? "Refreshing" : "Refresh"}
              </Button>
            </Flex>
          </Flex>

          <Separator my="2" size="4" />

          <Flex direction={{ initial: "column", sm: "row" }} align={{ initial: "start", sm: "center" }} gap="2">
            <Text size="2" color="gray">Device filter</Text>
            <Box style={{ width: "min(360px, 100%)" }}>
              <Select.Root value={selectedBatchDeviceId} onValueChange={setSelectedBatchDeviceId}>
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value="all">All devices</Select.Item>
                  {batchDeviceOptions.map((option) => (
                    <Select.Item key={option.id} value={option.id}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Box>
          </Flex>

          {batchesError ? (
            <Callout.Root color="tomato">
              <Callout.Text>{batchesError}</Callout.Text>
            </Callout.Root>
          ) : null}
          {batchActionError ? (
            <Callout.Root color="tomato">
              <Callout.Text>{batchActionError}</Callout.Text>
            </Callout.Root>
          ) : null}
          {batchActionMessage ? (
            <Callout.Root color="green">
              <Callout.Text>{batchActionMessage}</Callout.Text>
            </Callout.Root>
          ) : null}

          {filteredBatches.length === 0 ? (
            <Text color="gray" style={{ fontStyle: "italic" }}>
              {isLoadingBatches ? "Loading batches…" : "No batches available for this filter."}
            </Text>
          ) : (
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Device</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Batch</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Uploaded</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Points</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Visibility</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Moderation</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Actions</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {visibleBatches.map((batch) => {
                  const actionKey = `${batch.deviceId}:${batch.batchId}`;
                  const isUpdating = updatingBatchKey === actionKey;
                  const isDeleting = deletingBatchKey === actionKey;
                  const isBusy = isUpdating || isDeleting;
                  const processedMs = timestampToMillis(batch.processedAt);
                  const processedAtLabel = processedMs === null ? "—" : new Date(processedMs).toLocaleString();
                  const deviceLabel = batch.deviceName?.trim().length
                    ? batch.deviceName
                    : (deviceNameLookup.get(batch.deviceId) ?? batch.deviceId);
                  return (
                    <Table.Row key={actionKey}>
                      <Table.Cell>
                        <Flex direction="column" gap="1">
                          <Text weight="medium">{deviceLabel}</Text>
                          <Text size="1" color="gray" style={{ fontFamily: "monospace" }}>{batch.deviceId}</Text>
                        </Flex>
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="2" style={{ fontFamily: "monospace" }}>{batch.batchId}</Text>
                      </Table.Cell>
                      <Table.Cell>{processedAtLabel}</Table.Cell>
                      <Table.Cell>{batch.count}</Table.Cell>
                      <Table.Cell>
                        <Badge color={batch.visibility === "public" ? "green" : "gray"} variant="soft">
                          {batch.visibility}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={batch.moderationState === "approved" ? "green" : "red"} variant="soft">
                          {batch.moderationState}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Flex gap="2" wrap="wrap">
                          <Button
                            variant="soft"
                            size="1"
                            disabled={isBusy}
                            onClick={() => handleToggleBatchVisibility(batch)}
                          >
                            {isUpdating
                              ? "Updating…"
                              : batch.visibility === "public"
                                ? "Make private"
                                : "Make public"}
                          </Button>
                          <Button
                            variant="soft"
                            color="tomato"
                            size="1"
                            disabled={isBusy}
                            onClick={() => handleDeleteBatch(batch)}
                          >
                            {isDeleting ? "Deleting…" : "Delete"}
                          </Button>
                        </Flex>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
