import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Card, Flex, Heading, SegmentedControl, Separator, Table, Text, TextField, Callout, Switch, Select } from "@radix-ui/themes";
import { ReloadIcon } from "@radix-ui/react-icons";
import { timestampToMillis } from "@crowdpm/types";
import {
  deleteBatch,
  listBatches,
  listDevices,
  revokeDevice,
  updateBatchVisibility,
  type BatchSummary,
  type BatchVisibility,
  type DeviceSummary,
} from "../lib/api";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";
import { buildActivationLink } from "../lib/activation";

type UserDashboardProps = {
  onRequestActivation: () => void;
};

function describeStatus(status?: string | null): { label: string; tone: "green" | "yellow" | "red" | "gray" } {
  const normalized = (status ?? "").toLowerCase();
  if (["active", "ok", "ready"].includes(normalized)) return { label: "Active", tone: "green" };
  if (["pending", "provisioning"].includes(normalized)) return { label: "Provisioning", tone: "yellow" };
  if (!normalized) return { label: "Unknown", tone: "gray" };
  return { label: status ?? "Unknown", tone: "red" };
}

export default function UserDashboard({ onRequestActivation }: UserDashboardProps) {
  const { user } = useAuth();
  const { settings, isLoading: isSettingsLoading, isSaving: isSettingsSaving, error: settingsError, updateSettings } = useUserSettings();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [isLoadingBatches, setIsLoadingBatches] = useState(false);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [selectedBatchDeviceId, setSelectedBatchDeviceId] = useState<string>("all");
  const [batchActionError, setBatchActionError] = useState<string | null>(null);
  const [batchActionMessage, setBatchActionMessage] = useState<string | null>(null);
  const [updatingBatchKey, setUpdatingBatchKey] = useState<string | null>(null);
  const [deletingBatchKey, setDeletingBatchKey] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsLocalError, setSettingsLocalError] = useState<string | null>(null);
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

  useEffect(() => { refreshDevices(); }, [refreshDevices]);
  useEffect(() => { refreshBatches(); }, [refreshBatches]);

  const ownedCount = useMemo(() => devices.length, [devices]);
  const activeCount = useMemo(
    () => devices.filter((device) => describeStatus(device.registryStatus ?? device.status).tone === "green").length,
    [devices],
  );
  const isSettingsBusy = isSettingsLoading || isSettingsSaving;
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

  useEffect(() => {
    if (selectedBatchDeviceId === "all") return;
    const stillExists = batchDeviceOptions.some((option) => option.id === selectedBatchDeviceId);
    if (!stillExists) {
      setSelectedBatchDeviceId("all");
    }
  }, [batchDeviceOptions, selectedBatchDeviceId]);

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
      console.error(err);
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
                <a href="/activate" target="_blank" rel="noreferrer">Open in current tab</a>
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
          <Heading as="h3" size="4">Add a device</Heading>
          <Text color="gray">
            Plug in your node, wait for the pairing code to appear, and open the activation UI to approve the request.
          </Text>
          <Button onClick={handleOpenActivation} style={{ alignSelf: "start" }}>
            Open activation UI
          </Button>
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
          </Flex>
          <Button variant="soft" onClick={refreshDevices} disabled={isLoadingDevices}>
            <ReloadIcon /> {isLoadingDevices ? "Refreshing" : "Refresh"}
          </Button>
        </Flex>
        {devicesError ? (
          <Text mt="3" color="tomato">{devicesError}</Text>
        ) : null}
      </Card>

      <Card id="user-settings">
        <Flex direction="column" gap="3">
          <Heading as="h3" size="4">User settings</Heading>
          <Text color="gray">Choose the default visibility applied to new ingest batches.</Text>
          <Separator my="2" size="4" />
          <Text size="2" color="gray">Default batch visibility</Text>
          <SegmentedControl.Root
            value={settings.defaultBatchVisibility}
            onValueChange={handleDefaultVisibilityChange}
            disabled={isSettingsBusy}
          >
            <SegmentedControl.Item value="public">Public</SegmentedControl.Item>
            <SegmentedControl.Item value="private">Private</SegmentedControl.Item>
          </SegmentedControl.Root>
          <Text size="1" color="gray">
            Public batches can be surfaced in shared dashboards, while private batches remain restricted to your account.
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
          <Heading as="h3" size="4">Registered devices</Heading>
          <Text color="gray">These are exposed by the Functions API via /v1/devices for your account.</Text>
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
                {devices.map((device) => {
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
            <Button variant="soft" onClick={refreshBatches} disabled={isLoadingBatches}>
              <ReloadIcon /> {isLoadingBatches ? "Refreshing" : "Refresh"}
            </Button>
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
                {filteredBatches.map((batch) => {
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
