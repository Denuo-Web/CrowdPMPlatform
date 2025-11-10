import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Card, Flex, Heading, SegmentedControl, Separator, Table, Text, TextField, Callout } from "@radix-ui/themes";
import { ReloadIcon } from "@radix-ui/react-icons";
import { listDevices, revokeDevice, type BatchVisibility, type DeviceSummary } from "../lib/api";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsLocalError, setSettingsLocalError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!user) {
      setDevices([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const next = await listDevices();
      setDevices(next);
    }
    catch (err) {
      setDevices([]);
      setError(err instanceof Error ? err.message : "Unable to load devices");
    }
    finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => { refreshDevices(); }, [refreshDevices]);
  const ownedCount = useMemo(() => devices.length, [devices]);
  const activeCount = useMemo(
    () => devices.filter((device) => describeStatus(device.registryStatus ?? device.status).tone === "green").length,
    [devices],
  );
  const isSettingsBusy = isSettingsLoading || isSettingsSaving;

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

  const handleRevoke = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    if (!window.confirm("Revoke this device? It will immediately lose access tokens.")) {
      return;
    }
    setRevokeError(null);
    setRevokingId(deviceId);
    try {
      await revokeDevice(deviceId);
      await refreshDevices();
    }
    catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Unable to revoke device.");
    }
    finally {
      setRevokingId(null);
    }
  }, [refreshDevices]);

  const handleOpenActivation = useCallback(() => {
    onRequestActivation();
  }, [onRequestActivation]);


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
          <Button onClick={handleOpenActivation} alignSelf="start">
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
          <Button variant="soft" onClick={refreshDevices} disabled={isLoading}>
            <ReloadIcon /> {isLoading ? "Refreshing" : "Refresh"}
          </Button>
        </Flex>
        {error ? (
          <Text mt="3" color="tomato">{error}</Text>
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
              {isLoading ? "Loading devices…" : "No devices are currently linked to this account."}
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
                  const created = device.createdAt
                    ? new Date(device.createdAt).toLocaleDateString()
                    : "—";
                  const lastSeen = device.lastSeenAt
                    ? new Date(device.lastSeenAt).toLocaleString()
                    : "—";
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
    </Flex>
  );
}
