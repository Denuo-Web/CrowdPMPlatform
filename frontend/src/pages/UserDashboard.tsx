import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  onOpenThemeModal: () => void;
  subscriptionCheckoutNotice?: "success" | "cancelled" | null;
  subscriptionCheckoutSessionId?: string | null;
  onSubscriptionCheckoutHandled?: () => void;
  refreshToken?: number;
};

const DASHBOARD_QUERY_KEYS = {
  devices: (userId: string | null) => ["dashboard", "devices", userId ?? "anon"] as const,
  batches: (userId: string | null) => ["dashboard", "batches", userId ?? "anon"] as const,
  receipts: (userId: string | null) => ["dashboard", "receipts", userId ?? "anon"] as const,
};
const EMPTY_DEVICES: DeviceSummary[] = [];
const EMPTY_BATCHES: BatchSummary[] = [];
const EMPTY_RECEIPTS: NodePurchaseReceipt[] = [];

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
  if (receipt.purchaseType === "certification_support") {
    return "No shipment";
  }
  const address = receipt.shippingAddress;
  const city = address?.city?.trim();
  const state = address?.state?.trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || "Pending authorization";
}

function formatReceiptTier(receipt: NodePurchaseReceipt): string {
  return receipt.tierLabel ?? receipt.variantLabel ?? (
    receipt.purchaseType === "certification_support" ? "Certification support" : "Founding node reservation"
  );
}

export default function UserDashboard({
  onRequestActivation,
  onOpenThemeModal,
  subscriptionCheckoutNotice = null,
  subscriptionCheckoutSessionId = null,
  onSubscriptionCheckoutHandled,
  refreshToken = 0,
}: UserDashboardProps) {
  const { user } = useAuth();
  const { settings, isLoading: isSettingsLoading, isSaving: isSettingsSaving, error: settingsError, refresh, updateSettings } = useUserSettings();
  const queryClient = useQueryClient();
  const userId = user?.uid ?? null;
  const devicesQueryKey = useMemo(() => DASHBOARD_QUERY_KEYS.devices(userId), [userId]);
  const batchesQueryKey = useMemo(() => DASHBOARD_QUERY_KEYS.batches(userId), [userId]);
  const receiptsQueryKey = useMemo(() => DASHBOARD_QUERY_KEYS.receipts(userId), [userId]);
  const devicesQuery = useQuery<DeviceSummary[]>({
    queryKey: devicesQueryKey,
    enabled: Boolean(user),
    queryFn: listDevices,
    placeholderData: EMPTY_DEVICES,
  });
  const batchesQuery = useQuery<BatchSummary[]>({
    queryKey: batchesQueryKey,
    enabled: Boolean(user),
    queryFn: () => listBatches(),
    placeholderData: EMPTY_BATCHES,
  });
  const receiptsQuery = useQuery<NodePurchaseReceipt[]>({
    queryKey: receiptsQueryKey,
    enabled: Boolean(user),
    queryFn: listNodePurchaseReceipts,
    placeholderData: EMPTY_RECEIPTS,
  });
  const devices = user ? devicesQuery.data ?? EMPTY_DEVICES : EMPTY_DEVICES;
  const batches = user ? batchesQuery.data ?? EMPTY_BATCHES : EMPTY_BATCHES;
  const receipts = user ? receiptsQuery.data ?? EMPTY_RECEIPTS : EMPTY_RECEIPTS;
  const isLoadingDevices = Boolean(user) && devicesQuery.isFetching;
  const isLoadingBatches = Boolean(user) && batchesQuery.isFetching;
  const isLoadingReceipts = Boolean(user) && receiptsQuery.isFetching;
  const devicesError = devicesQuery.error instanceof Error ? devicesQuery.error.message : null;
  const batchesError = batchesQuery.error instanceof Error ? batchesQuery.error.message : null;
  const receiptsError = receiptsQuery.error instanceof Error ? receiptsQuery.error.message : null;
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [devicePageIndexInput, setDevicePageIndexInput] = useState(0);
  const [selectedBatchDeviceId, setSelectedBatchDeviceId] = useState<string>("all");
  const [batchActionError, setBatchActionError] = useState<string | null>(null);
  const [batchActionMessage, setBatchActionMessage] = useState<string | null>(null);
  const [batchPageIndexInput, setBatchPageIndexInput] = useState(0);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsLocalError, setSettingsLocalError] = useState<string | null>(null);
  const [subscriptionMessage, setSubscriptionMessage] = useState<string | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [activeCheckoutOfferId, setActiveCheckoutOfferId] = useState<"pro_monthly" | "pro_yearly" | null>(null);
  const [isOpeningBillingPortal, setOpeningBillingPortal] = useState(false);
  const activationUrl = useMemo(() => buildActivationLink(), []);
  const [activationLinkMessage, setActivationLinkMessage] = useState<string | null>(null);
  const handledSubscriptionCheckoutRef = useRef<string | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!user) return;
    await devicesQuery.refetch();
  }, [devicesQuery, user]);

  const refreshBatches = useCallback(async () => {
    if (!user) return;
    await batchesQuery.refetch();
  }, [batchesQuery, user]);

  const refreshReceipts = useCallback(async () => {
    if (!user) return;
    await receiptsQuery.refetch();
  }, [receiptsQuery, user]);

  useEffect(() => {
    if (!user || refreshToken === 0) return;
    void refreshDevices();
    void refreshBatches();
    void refreshReceipts();
  }, [refreshBatches, refreshDevices, refreshReceipts, refreshToken, user]);

  const revokeDeviceMutation = useMutation({
    mutationFn: revokeDevice,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: devicesQueryKey }),
        queryClient.invalidateQueries({ queryKey: batchesQueryKey }),
      ]);
    },
  });
  const updateBatchVisibilityMutation = useMutation({
    mutationFn: async (args: { batch: BatchSummary; nextVisibility: BatchVisibility; actionKey: string }) => {
      return updateBatchVisibility(args.batch.deviceId, args.batch.batchId, args.nextVisibility);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<BatchSummary[]>(batchesQueryKey, (prev = []) => prev.map((row) => (
        row.deviceId === updated.deviceId && row.batchId === updated.batchId ? updated : row
      )));
    },
  });
  const deleteBatchMutation = useMutation({
    mutationFn: async (batch: BatchSummary) => {
      await deleteBatch(batch.deviceId, batch.batchId);
      return batch;
    },
    onSuccess: (deletedBatch) => {
      queryClient.setQueryData<BatchSummary[]>(batchesQueryKey, (prev = []) => prev.filter((row) => (
        row.deviceId !== deletedBatch.deviceId || row.batchId !== deletedBatch.batchId
      )));
    },
  });
  const revokingId = revokeDeviceMutation.isPending ? revokeDeviceMutation.variables ?? null : null;
  const updatingBatchKey = updateBatchVisibilityMutation.isPending ? updateBatchVisibilityMutation.variables?.actionKey ?? null : null;
  const deletingBatchKey = deleteBatchMutation.isPending
    ? `${deleteBatchMutation.variables?.deviceId ?? ""}:${deleteBatchMutation.variables?.batchId ?? ""}`
    : null;

  useEffect(() => {
    if (!user || !subscriptionCheckoutNotice) {
      return;
    }
    const handledKey = `${user.uid}:${subscriptionCheckoutNotice}:${subscriptionCheckoutSessionId ?? "none"}`;
    if (handledSubscriptionCheckoutRef.current === handledKey) {
      return;
    }
    handledSubscriptionCheckoutRef.current = handledKey;
    let cancelled = false;

    void (async () => {
      try {
        setSubscriptionError(null);
        setSubscriptionMessage(
          subscriptionCheckoutNotice === "cancelled"
            ? "Subscription checkout was cancelled before it completed."
            : "Subscription checkout completed. Refreshing account access…"
        );
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

  const ownedCount = devices.length;
  const completedReceiptCount = receipts.length;
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
  const effectiveSelectedBatchDeviceId = selectedBatchDeviceId === "all"
    || batchDeviceOptions.some((option) => option.id === selectedBatchDeviceId)
    ? selectedBatchDeviceId
    : "all";
  const filteredBatches = useMemo(() => {
    const byDevice = effectiveSelectedBatchDeviceId === "all"
      ? batches
      : batches.filter((batch) => batch.deviceId === effectiveSelectedBatchDeviceId);
    return [...byDevice].sort((a, b) => {
      const timeA = timestampToMillis(a.processedAt) ?? 0;
      const timeB = timestampToMillis(b.processedAt) ?? 0;
      return timeB - timeA;
    });
  }, [batches, effectiveSelectedBatchDeviceId]);
  const devicePageIndex = clampPageIndex(devices.length, devicePageIndexInput);
  const batchPageIndex = clampPageIndex(filteredBatches.length, batchPageIndexInput);
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
    try {
      await revokeDeviceMutation.mutateAsync(deviceId);
    }
    catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Unable to revoke device.");
    }
  }, [revokeDeviceMutation]);

  const handleToggleBatchVisibility = useCallback(async (batch: BatchSummary) => {
    const actionKey = `${batch.deviceId}:${batch.batchId}`;
    const nextVisibility: BatchVisibility = batch.visibility === "public" ? "private" : "public";
    setBatchActionError(null);
    setBatchActionMessage(null);
    try {
      await updateBatchVisibilityMutation.mutateAsync({ batch, nextVisibility, actionKey });
      setBatchActionMessage(
        nextVisibility === "public"
          ? `Batch ${batch.batchId} is now public.`
          : `Batch ${batch.batchId} is now private.`
      );
    }
    catch (err) {
      setBatchActionError(err instanceof Error ? err.message : "Unable to update batch visibility.");
    }
  }, [updateBatchVisibilityMutation]);

  const handleDeleteBatch = useCallback(async (batch: BatchSummary) => {
    if (!window.confirm(`Delete batch ${batch.batchId}? This removes the saved payload and batch metadata.`)) {
      return;
    }
    setBatchActionError(null);
    setBatchActionMessage(null);
    try {
      await deleteBatchMutation.mutateAsync(batch);
      setBatchActionMessage(`Deleted batch ${batch.batchId}.`);
    }
    catch (err) {
      setBatchActionError(err instanceof Error ? err.message : "Unable to delete batch.");
    }
  }, [deleteBatchMutation]);

  const handleOpenActivation = useCallback(() => {
    onRequestActivation();
  }, [onRequestActivation]);

  const handleBatchDeviceFilterChange = useCallback((nextValue: string) => {
    setSelectedBatchDeviceId(nextValue);
    setBatchPageIndexInput(0);
  }, []);

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
              <Text size="2" color="gray">Campaign payments</Text>
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
              <Heading as="h3" size="4">Campaign receipts</Heading>
              <Text color="gray">Completed node reservations and certification support tied to this signed-in account.</Text>
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
              {isLoadingReceipts ? "Loading receipts…" : "No completed campaign payments for this account."}
            </Text>
          ) : (
            <Table.Root>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Tier</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Units</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Total</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Fulfillment</Table.ColumnHeaderCell>
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
                    <Table.Cell>
                      <Flex direction="column" gap="1">
                        <Text>{formatReceiptTier(receipt)}</Text>
                        <Badge color={receipt.purchaseType === "certification_support" ? "blue" : "amber"} variant="soft">
                          {receipt.purchaseType === "certification_support" ? "Support only" : "Conditional reservation"}
                        </Badge>
                      </Flex>
                    </Table.Cell>
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
          {subscription.limits.maxStoredPrivateBatches < 1 ? (
            <SegmentedControl.Root value="public" disabled>
              <SegmentedControl.Item value="public">Public</SegmentedControl.Item>
            </SegmentedControl.Root>
          ) : (
            <SegmentedControl.Root
              value={settings.defaultBatchVisibility}
              onValueChange={handleDefaultVisibilityChange}
              disabled={isSettingsBusy}
            >
              <SegmentedControl.Item value="public">Public</SegmentedControl.Item>
              <SegmentedControl.Item value="private">Private</SegmentedControl.Item>
            </SegmentedControl.Root>
          )}
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
              onShowLess={() => setDevicePageIndexInput((current) => current - 1)}
              onShowMore={() => setDevicePageIndexInput((current) => current + 1)}
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
              onShowLess={() => setBatchPageIndexInput((current) => current - 1)}
              onShowMore={() => setBatchPageIndexInput((current) => current + 1)}
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
              <Select.Root value={effectiveSelectedBatchDeviceId} onValueChange={handleBatchDeviceFilterChange}>
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
