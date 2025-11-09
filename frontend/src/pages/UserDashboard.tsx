import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Box, Button, Card, Flex, Heading, SegmentedControl, Separator, Table, Text } from "@radix-ui/themes";
import { ReloadIcon } from "@radix-ui/react-icons";
import { listDevices, type BatchVisibility, type DeviceSummary } from "../lib/api";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";

function describeStatus(status?: string | null): { label: string; tone: "green" | "yellow" | "red" | "gray" } {
  const normalized = (status ?? "").toLowerCase();
  if (["active", "ok", "ready"].includes(normalized)) return { label: "Active", tone: "green" };
  if (["pending", "provisioning"].includes(normalized)) return { label: "Provisioning", tone: "yellow" };
  if (!normalized) return { label: "Unknown", tone: "gray" };
  return { label: status ?? "Unknown", tone: "red" };
}

export default function UserDashboard() {
  const { user } = useAuth();
  const { settings, isLoading: isSettingsLoading, isSaving: isSettingsSaving, error: settingsError, updateSettings } = useUserSettings();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const activeCount = useMemo(() => devices.filter((device) => describeStatus(device.status).tone === "green").length, [devices]);
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

  if (!user) {
    return (
      <Card>
        <Flex direction="column" gap="3">
          <Heading size="4">User Dashboard</Heading>
          <Text color="gray">Sign in to review the devices tied to your account.</Text>
        </Flex>
      </Card>
    );
  }

  return (
    <Flex direction="column" gap="5">
      <Box>
        <Heading as="h2" size="5">Welcome back, {user.email ?? user.uid}</Heading>
        <Text color="gray">Monitor the devices that are registered to your CrowdPM ingest pipeline.</Text>
      </Box>

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

      <Card>
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
                  <Table.ColumnHeaderCell>Created</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {devices.map((device) => {
                  const status = describeStatus(device.status);
                  const created = device.createdAt
                    ? new Date(device.createdAt).toLocaleDateString()
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
                      <Table.Cell>{created}</Table.Cell>
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
