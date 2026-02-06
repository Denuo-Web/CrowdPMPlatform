import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { timestampToMillis } from "@crowdpm/types";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  ScrollArea,
  SegmentedControl,
  Select,
  Separator,
  Slider,
  Switch,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import {
  CalendarIcon,
  MagicWandIcon,
  MixerHorizontalIcon,
  Pencil2Icon,
  ReloadIcon,
  RocketIcon,
  TrashIcon,
} from "@radix-ui/react-icons";
import {
  cleanupIngestSmokeTest,
  runIngestSmokeTest,
  type BatchVisibility,
  type IngestSmokeTestPayload,
  type IngestSmokeTestPoint,
  type IngestSmokeTestResponse,
  type IngestSmokeTestCleanupResponse,
} from "../lib/api";
import { usePersistedSmokePayload, useSmokeTestStorage } from "../hooks/useSmokeTestStorage";
import { logWarning } from "../lib/logger";
import { scopedStorageKey } from "../lib/storage";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";
import type { SmokeHistoryItem } from "../types/smokeTest";

const PAYLOAD_STORAGE_KEY = "crowdpm:lastSmokePayload";
const HISTORY_STORAGE_KEY = "crowdpm:smokeHistory";
const LAST_DEVICE_STORAGE_KEY = "crowdpm:lastSmokeTestDevice";
const LAST_SELECTION_STORAGE_KEY = "crowdpm:lastSmokeSelection";
const LAST_BATCH_CACHE_STORAGE_KEY = "crowdpm:lastSmokeBatchCache";

const DEFAULT_POINT_COUNT = 60; // one minute of per-second readings

const UNIT_LABEL = "\u00b5g/m\u00b3"; // micrograms per cubic meter

type CityPreset = {
  value: string;
  label: string;
  description: string;
  path: Array<{ lat: number; lon: number }>;
};

const CITY_PRESETS: CityPreset[] = [
  {
    value: "manhattan",
    label: "Lower Manhattan, NY",
    description: "Battery Park to Bryant Park with light Hudson drift",
    path: [
      { lat: 40.7033, lon: -74.0170 },
      { lat: 40.7088, lon: -74.0125 },
      { lat: 40.7168, lon: -74.0060 },
      { lat: 40.7255, lon: -73.9995 },
      { lat: 40.7344, lon: -73.9921 },
      { lat: 40.7440, lon: -73.9862 },
      { lat: 40.7527, lon: -73.9787 },
    ],
  },
  {
    value: "portland",
    label: "Portland, OR",
    description: "Pearl District across the river into SE",
    path: [
      { lat: 45.5293, lon: -122.6847 },
      { lat: 45.5284, lon: -122.6716 },
      { lat: 45.5317, lon: -122.6611 },
      { lat: 45.5252, lon: -122.6594 },
      { lat: 45.5201, lon: -122.6532 },
      { lat: 45.5140, lon: -122.6467 },
      { lat: 45.5088, lon: -122.6380 },
    ],
  },
  {
    value: "sanfrancisco",
    label: "San Francisco, CA",
    description: "Crissy Field through Market St to the Mission",
    path: [
      { lat: 37.8060, lon: -122.4750 },
      { lat: 37.8044, lon: -122.4291 },
      { lat: 37.8003, lon: -122.4090 },
      { lat: 37.7955, lon: -122.3990 },
      { lat: 37.7888, lon: -122.4018 },
      { lat: 37.7811, lon: -122.4101 },
      { lat: 37.7689, lon: -122.4148 },
    ],
  },
  {
    value: "london",
    label: "London, UK",
    description: "Trafalgar Square, South Bank, Westminster loop",
    path: [
      { lat: 51.5080, lon: -0.1281 },
      { lat: 51.5136, lon: -0.1046 },
      { lat: 51.5104, lon: -0.0837 },
      { lat: 51.5060, lon: -0.0985 },
      { lat: 51.5033, lon: -0.1195 },
      { lat: 51.5007, lon: -0.1246 },
      { lat: 51.4943, lon: -0.1466 },
    ],
  },
];

const PRECISION_PRESETS = [
  { value: "high", label: "High", range: [1, 4] as const, hint: "Lab grade sensor", gradient: "linear-gradient(90deg, var(--green-8), var(--grass-9))" },
  { value: "medium", label: "Medium", range: [5, 14] as const, hint: "Mobile demo sensor", gradient: "linear-gradient(90deg, var(--iris-8), var(--violet-9))" },
  { value: "low", label: "Low", range: [15, 32] as const, hint: "Conceptual or noisy input", gradient: "linear-gradient(90deg, var(--orange-8), var(--amber-9))" },
] as const;

type PrecisionLevel = (typeof PRECISION_PRESETS)[number]["value"];

type ControlState = {
  massDeviceId: string;
  massPollutant: string;
  batchVisibility: BatchVisibility;
  selectedCity: string;
  jitterMeters: number;
  useCurrentTime: boolean;
  customDate: string;
  customTime: string;
  precisionLevel: PrecisionLevel;
};

function createDefaultSmokePayload(deviceId = "device-123"): IngestSmokeTestPayload {
  const now = Date.now();
  const points = Array.from({ length: DEFAULT_POINT_COUNT }, (_, idx) => {
    const secondsAgo = DEFAULT_POINT_COUNT - idx - 1;
    const ts = new Date(now - secondsAgo * 1000);
    const progress = idx / (DEFAULT_POINT_COUNT - 1);
    const lat = 40.7128 + Math.sin(progress * Math.PI * 2) * 0.00015;
    const lon = -74.0060 + Math.cos(progress * Math.PI * 2) * 0.00015;
    return {
      device_id: deviceId,
      pollutant: "pm25",
      value: Math.round((15 + Math.sin(progress * Math.PI * 4) * 8 + Math.random()) * 10) / 10,
      unit: UNIT_LABEL,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      timestamp: ts.toISOString(),
      precision: 8 + Math.round(Math.random() * 6),
      altitude: 0,
    } satisfies IngestSmokeTestPoint;
  });
  return { points };
}

function parseSmokeHistory(raw: string | null): SmokeHistoryItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const candidate = item as Partial<SmokeHistoryItem>;
        if (!candidate.response || typeof candidate.id !== "string" || typeof candidate.createdAt !== "number") return null;
        const initialIds = Array.isArray(candidate.deviceIds) && candidate.deviceIds.length
          ? candidate.deviceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          : [];
        const fallback = candidate.response.seededDeviceIds?.length
          ? candidate.response.seededDeviceIds
          : [candidate.response.deviceId, candidate.response.seededDeviceId];
        const deviceIds = Array.from(new Set([...initialIds, ...fallback.filter((id): id is string => typeof id === "string" && id.trim().length > 0)]));
        return {
          id: candidate.id,
          createdAt: candidate.createdAt,
          deviceIds,
          response: candidate.response,
        } as SmokeHistoryItem;
      })
      .filter((item): item is SmokeHistoryItem => Boolean(item));
  }
  catch (err) {
    logWarning("Unable to parse smoke test history", { rawLength: raw.length }, err);
    return [];
  }
}

function determinePayloadForEditor(result: IngestSmokeTestResponse | null): string {
  if (!result) return JSON.stringify(createDefaultSmokePayload(), null, 2);
  const payload = result.payload?.points?.length
    ? result.payload
    : { points: result.points ?? [] };
  return JSON.stringify(payload, null, 2);
}

function uniqueDeviceIdsFromResult(result: IngestSmokeTestResponse | null): string[] {
  if (!result) return [];
  const ids = result.seededDeviceIds?.length
    ? result.seededDeviceIds
    : [result.deviceId, result.seededDeviceId];
  return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)));
}

function parsePayload(raw: string): IngestSmokeTestPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  }
  catch (err) {
    throw new Error(err instanceof Error ? err.message : "Invalid JSON payload");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Payload must be a JSON object with a points array");
  const points = (parsed as { points?: unknown }).points;
  if (!Array.isArray(points) || points.length === 0) throw new Error("Payload must include at least one point in a points array");
  return { points: points as IngestSmokeTestPoint[] };
}

function metersToLatDegrees(meters: number): number {
  return meters / 111_320;
}

function metersToLonDegrees(meters: number, latitude: number): number {
  const denom = 111_320 * Math.cos((latitude * Math.PI) / 180);
  return denom === 0 ? 0 : meters / denom;
}

function interpolatePath(path: CityPreset["path"], progress: number): { lat: number; lon: number } {
  if (path.length === 1) return path[0];
  const totalSegments = path.length - 1;
  const scaled = progress * totalSegments;
  const leftIndex = Math.min(Math.floor(scaled), totalSegments - 1);
  const rightIndex = Math.min(leftIndex + 1, path.length - 1);
  const localT = scaled - leftIndex;
  const left = path[leftIndex];
  const right = path[rightIndex];
  return {
    lat: left.lat + (right.lat - left.lat) * localT,
    lon: left.lon + (right.lon - left.lon) * localT,
  };
}

function randomBetween([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

function buildCustomDate(dateValue: string, timeValue: string): Date {
  const now = new Date();
  const [year, month, day] = (dateValue || now.toISOString().slice(0, 10)).split("-").map((part) => Number(part));
  const [hours, minutes] = (timeValue || now.toISOString().slice(11, 16)).split(":" ).map((part) => Number(part));
  const base = new Date();
  base.setFullYear(year || now.getFullYear(), (month || now.getMonth() + 1) - 1, day || now.getDate());
  base.setHours(hours || 0, minutes || 0, 0, 0);
  return base;
}

function safePointCount(raw: string): number {
  try {
    const payload = parsePayload(raw);
    return payload.points.length || DEFAULT_POINT_COUNT;
  }
  catch {
    return DEFAULT_POINT_COUNT;
  }
}

function generateCityPayload(options: {
  city: CityPreset;
  jitterMeters: number;
  deviceId: string;
  pollutant: string;
  baseTimestamp: Date;
  precisionRange: readonly [number, number];
  pointsCount: number;
}): IngestSmokeTestPayload {
  const {
    city,
    jitterMeters,
    deviceId,
    pollutant,
    baseTimestamp,
    precisionRange,
    pointsCount,
  } = options;
  const latJitter = metersToLatDegrees(jitterMeters);
  const points = Array.from({ length: pointsCount }, (_, idx) => {
    const progress = idx / Math.max(pointsCount - 1, 1);
    const { lat, lon } = interpolatePath(city.path, progress);
    const jitterLat = (Math.random() - 0.5) * 2 * latJitter;
    const jitterLon = (Math.random() - 0.5) * 2 * metersToLonDegrees(jitterMeters, lat);
    const altitude = Math.random() * 0.8; // stay near ground level
    const ts = new Date(baseTimestamp.getTime() - (pointsCount - idx - 1) * 1000);
    const value = 10 + Math.sin(progress * Math.PI * 3) * 6 + Math.random() * 2;
    return {
      device_id: deviceId || "demo-device",
      pollutant: pollutant || "pm25",
      value: Math.round(value * 10) / 10,
      unit: UNIT_LABEL,
      lat: Number((lat + jitterLat).toFixed(6)),
      lon: Number((lon + jitterLon).toFixed(6)),
      timestamp: ts.toISOString(),
      precision: Math.round(randomBetween(precisionRange)),
      altitude: Number(altitude.toFixed(1)),
    } satisfies IngestSmokeTestPoint;
  });
  return { points };
}

function rewritePoints(
  raw: string,
  mapper: (point: IngestSmokeTestPoint, index: number, total: number) => IngestSmokeTestPoint
): string {
  const payload = parsePayload(raw);
  const nextPoints = payload.points.map((point, index, arr) => mapper(point, index, arr.length));
  return JSON.stringify({ points: nextPoints }, null, 2);
}

type SmokeTestLabProps = {
  onSmokeTestComplete?: (result: IngestSmokeTestResponse) => void;
  onSmokeTestCleared?: (detail: IngestSmokeTestCleanupResponse) => void;
};

export default function SmokeTestLab({ onSmokeTestComplete, onSmokeTestCleared }: SmokeTestLabProps = {}) {
  const { user } = useAuth();
  const { settings } = useUserSettings();
  const defaultPayload = useMemo(() => createDefaultSmokePayload(), []);
  const defaultPayloadString = useMemo(() => JSON.stringify(defaultPayload, null, 2), [defaultPayload]);
  const defaultDeviceId = defaultPayload.points[0]?.device_id ?? "device-123";
  const defaultPollutant = defaultPayload.points[0]?.pollutant ?? "pm25";

  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [smokeResult, setSmokeResult] = useState<IngestSmokeTestResponse | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [deletions, setDeletions] = useState<{ batchId: string | null; deviceId: string | null }>({
    batchId: null,
    deviceId: null,
  });
  const [controls, setControls] = useReducer(
    (state: ControlState, updates: Partial<ControlState>) => ({ ...state, ...updates }),
    {
      massDeviceId: defaultDeviceId,
      massPollutant: defaultPollutant,
      batchVisibility: settings.defaultBatchVisibility,
      selectedCity: CITY_PRESETS[0].value,
      jitterMeters: 40,
      useCurrentTime: true,
      customDate: new Date().toISOString().slice(0, 10),
      customTime: new Date().toISOString().slice(11, 16),
      precisionLevel: "medium",
    }
  );
  const deletingBatchId = deletions.batchId;
  const deletingDeviceId = deletions.deviceId;
  const {
    massDeviceId,
    massPollutant,
    batchVisibility,
    selectedCity,
    jitterMeters,
    useCurrentTime,
    customDate,
    customTime,
    precisionLevel,
  } = controls;

  const scopedPayloadKey = useMemo(
    () => scopedStorageKey(PAYLOAD_STORAGE_KEY, user?.uid),
    [user?.uid]
  );
  const scopedHistoryKey = useMemo(
    () => scopedStorageKey(HISTORY_STORAGE_KEY, user?.uid),
    [user?.uid]
  );
  const scopedLastDeviceKey = useMemo(
    () => scopedStorageKey(LAST_DEVICE_STORAGE_KEY, user?.uid),
    [user?.uid]
  );
  const scopedSelectionKey = useMemo(
    () => scopedStorageKey(LAST_SELECTION_STORAGE_KEY, user?.uid),
    [user?.uid]
  );
  const scopedLastBatchCacheKey = useMemo(
    () => scopedStorageKey(LAST_BATCH_CACHE_STORAGE_KEY, user?.uid),
    [user?.uid]
  );

  const syncControlsFromPayload = useCallback((raw: string) => {
    try {
      const payload = parsePayload(raw);
      const first = payload.points[0];
      const updates: Partial<ControlState> = {};
      if (first?.device_id) updates.massDeviceId = first.device_id;
      if (first?.pollutant) updates.massPollutant = first.pollutant;
      if (Object.keys(updates).length) setControls(updates);
    }
    catch {
      // ignore sync failures when payload is mid-edit
    }
  }, []);

  const [smokePayload, setSmokePayload] = usePersistedSmokePayload({
    storageKey: scopedPayloadKey,
    defaultPayload: defaultPayloadString,
    userId: user?.uid,
    onLoad: syncControlsFromPayload,
  });

  const {
    history: smokeHistory,
    updateHistory,
    persistRunArtifacts,
    clearArtifactsForDevices,
    clearArtifactsForBatch,
  } = useSmokeTestStorage({
    historyKey: scopedHistoryKey,
    lastDeviceKey: scopedLastDeviceKey,
    selectionKey: scopedSelectionKey,
    batchCacheKey: scopedLastBatchCacheKey,
    userId: user?.uid,
    parseHistory: parseSmokeHistory,
  });

  const applyPrecisionRange = useCallback((nextLevel: PrecisionLevel) => {
    setControls({ precisionLevel: nextLevel });
    try {
      setSmokePayload((prev) => rewritePoints(prev, (point) => ({
        ...point,
        precision: Math.round(
          randomBetween(PRECISION_PRESETS.find((preset) => preset.value === nextLevel)?.range ?? [5, 15])
        ),
      })));
      setPayloadError(null);
    }
    catch (err) {
      setPayloadError(err instanceof Error ? err.message : "Unable to update precision");
    }
  }, [setSmokePayload]);

  const handleApplyDeviceId = useCallback(() => {
    try {
      const next = rewritePoints(smokePayload, (point) => ({ ...point, device_id: massDeviceId }));
      setSmokePayload(next);
      setPayloadError(null);
    }
    catch (err) {
      setPayloadError(err instanceof Error ? err.message : "Unable to update device IDs");
    }
  }, [smokePayload, massDeviceId, setSmokePayload]);

  const handleApplyPollutant = useCallback(() => {
    try {
      const next = rewritePoints(smokePayload, (point) => ({ ...point, pollutant: massPollutant }));
      setSmokePayload(next);
      setPayloadError(null);
    }
    catch (err) {
      setPayloadError(err instanceof Error ? err.message : "Unable to update pollutant");
    }
  }, [smokePayload, massPollutant, setSmokePayload]);

  const handleRewriteTimestamps = useCallback(() => {
    try {
      const base = useCurrentTime ? new Date() : buildCustomDate(customDate, customTime);
      const next = rewritePoints(smokePayload, (_point, index, total) => ({
        ..._point,
        timestamp: new Date(base.getTime() - (total - index - 1) * 1000).toISOString(),
      }));
      setSmokePayload(next);
      setPayloadError(null);
    }
    catch (err) {
      setPayloadError(err instanceof Error ? err.message : "Unable to rewrite timestamps");
    }
  }, [smokePayload, useCurrentTime, customDate, customTime, setSmokePayload]);

  const handleRegeneratePath = useCallback(() => {
    try {
      const city = CITY_PRESETS.find((preset) => preset.value === selectedCity) ?? CITY_PRESETS[0];
      const precisionRange = PRECISION_PRESETS.find((preset) => preset.value === precisionLevel)?.range ?? [5, 15];
      const pointCount = safePointCount(smokePayload);
      const baseTimestamp = useCurrentTime ? new Date() : buildCustomDate(customDate, customTime);
      const payload = generateCityPayload({
        city,
        jitterMeters,
        deviceId: massDeviceId,
        pollutant: massPollutant,
        baseTimestamp,
        precisionRange,
        pointsCount: pointCount,
      });
      const next = JSON.stringify(payload, null, 2);
      setSmokePayload(next);
      setPayloadError(null);
      syncControlsFromPayload(next);
    }
    catch (err) {
      setPayloadError(err instanceof Error ? err.message : "Unable to regenerate path");
    }
  }, [selectedCity, precisionLevel, smokePayload, useCurrentTime, customDate, customTime, jitterMeters, massDeviceId, massPollutant, syncControlsFromPayload, setSmokePayload]);

  async function handleSmokeTest() {
    if (!user) {
      setSmokeError("Sign in is required to run smoke tests.");
      return;
    }
    setIsRunning(true);
    setSmokeError(null);
    setPayloadError(null);
    try {
      const payload = parsePayload(smokePayload);
      const result = await runIngestSmokeTest(payload, { visibility: batchVisibility });
      setSmokeResult(result);
      const historyEntry: SmokeHistoryItem = {
        id: `${result.deviceId}:${result.batchId}`,
        createdAt: Date.now(),
        deviceIds: uniqueDeviceIdsFromResult(result),
        response: result,
      };
      updateHistory((prev) => [
        historyEntry,
        ...prev.filter((item) => item.response.batchId !== result.batchId),
      ].slice(0, 10));
      persistRunArtifacts({ result, payload, visibility: batchVisibility });
      onSmokeTestComplete?.(result);
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      if (err instanceof Error && err.message.toLowerCase().includes("payload")) {
        setPayloadError(message);
      } else {
        setSmokeError(message);
        setSmokeResult(null);
      }
    }
    finally {
      setIsRunning(false);
    }
  }

  async function handleHistoryCleanup(entry: SmokeHistoryItem) {
    if (!user) {
      setSmokeError("Sign in is required to delete smoke data.");
      return;
    }
    if (!entry.deviceIds.length) return;
    const targetIds = entry.deviceIds;
    setDeletions((prev) => ({ ...prev, deviceId: targetIds[0] }));
    setSmokeError(null);
    try {
      const response = await cleanupIngestSmokeTest(targetIds);
      clearArtifactsForDevices(targetIds);
      onSmokeTestCleared?.(response);
      updateHistory((prev) => prev.filter((item) => item.id !== entry.id));
      if (smokeResult && uniqueDeviceIdsFromResult(smokeResult).some((id) => targetIds.includes(id))) {
        setSmokeResult(null);
      }
    }
    catch (err) {
      setSmokeError(err instanceof Error ? err.message : "Cleanup failed");
    }
    finally {
      setDeletions((prev) => ({ ...prev, deviceId: null }));
    }
  }

  async function handleBatchCleanup(entry: SmokeHistoryItem) {
    if (!user) {
      setSmokeError("Sign in is required to delete smoke data.");
      return;
    }
    setDeletions((prev) => ({ ...prev, batchId: entry.response.batchId }));
    setSmokeError(null);
    try {
      updateHistory((prev) => prev.filter((item) => item.response.batchId !== entry.response.batchId));
      clearArtifactsForBatch(entry.response.deviceId, entry.response.batchId);
      if (smokeResult?.batchId === entry.response.batchId) {
        setSmokeResult(null);
      }
    }
    catch (err) {
      setSmokeError(err instanceof Error ? err.message : "Cleanup failed");
    }
    finally {
      setDeletions((prev) => ({ ...prev, batchId: null }));
    }
  }

  function loadHistoryPayload(entry: SmokeHistoryItem) {
    const next = determinePayloadForEditor(entry.response);
    setSmokePayload(next);
    setPayloadError(null);
    syncControlsFromPayload(next);
    setSmokeResult(entry.response);
  }

  const precisionPreset = PRECISION_PRESETS.find((preset) => preset.value === precisionLevel) ?? PRECISION_PRESETS[1];
  const jitterLabel = `${jitterMeters.toFixed(0)} m jitter`;

  const renderVisibilityBadge = (value: BatchVisibility) => (
    <Badge variant="soft" color={value === "public" ? "green" : "gray"}>
      {value === "public" ? "Public batch" : "Private batch"}
    </Badge>
  );

  useEffect(() => {
    setControls({ batchVisibility: settings.defaultBatchVisibility });
  }, [settings.defaultBatchVisibility]);

  return (
    <Flex direction="column" gap="5">
      <Box>
        <Heading as="h2" size="5">Smoke Test Lab</Heading>
        <Text color="gray">
          Mass-edit ingest payloads, choose a route, and run ingest smoke tests without editing every point by hand.
        </Text>
      </Box>

      <Card>
        <Flex direction="column" gap="4">
          <Flex align="center" gap="2">
            <MixerHorizontalIcon />
            <Heading as="h3" size="4">Payload controls</Heading>
          </Flex>
          <Grid columns={{ initial: "1", md: "3" }} gap="4">
            <Flex direction="column" gap="3">
              <Text size="2" color="gray">Device ID</Text>
              <Flex gap="2">
                <TextField.Root
                  style={{ flex: 1 }}
                  value={massDeviceId}
                  onChange={(event) => setControls({ massDeviceId: event.target.value })}
                  placeholder="device-123"
                />
                <Button onClick={handleApplyDeviceId} variant="soft">
                  <Pencil2Icon /> Apply
                </Button>
              </Flex>
              <Text size="2" color="gray">Pollutant</Text>
              <Flex gap="2">
                <TextField.Root
                  style={{ flex: 1 }}
                  value={massPollutant}
                  onChange={(event) => setControls({ massPollutant: event.target.value })}
                  placeholder="pm25"
                />
                <Button onClick={handleApplyPollutant} variant="soft">
                  <Pencil2Icon /> Apply
                </Button>
              </Flex>
              <Text size="1" color="gray">Unit is locked to {UNIT_LABEL} for demo parity.</Text>
            </Flex>

            <Flex direction="column" gap="3">
              <Text size="2" color="gray">City path</Text>
              <Select.Root value={selectedCity} onValueChange={(value) => setControls({ selectedCity: value })}>
                <Select.Trigger />
                <Select.Content>
                  {CITY_PRESETS.map((preset) => (
                    <Select.Item key={preset.value} value={preset.value}>
                      {preset.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <Text color="gray" size="1">{CITY_PRESETS.find((preset) => preset.value === selectedCity)?.description}</Text>
              <Text size="2" color="gray">Latitude / longitude jitter</Text>
              <Flex align="center" gap="3">
                <div style={{ flex: 1 }}>
                  <Slider
                    value={[jitterMeters]}
                    min={5}
                    max={250}
                    step={5}
                    onValueChange={(value) => setControls({ jitterMeters: value[0] })}
                  />
                </div>
                <Badge variant="soft">{jitterLabel}</Badge>
              </Flex>
              <Button onClick={handleRegeneratePath} variant="surface">
                <MagicWandIcon /> Regenerate trail
              </Button>
            </Flex>

            <Flex direction="column" gap="4">
              <Flex direction="column" gap="3">
                <Text size="2" color="gray">Timestamp alignment</Text>
                <Flex align="center" gap="2">
                  <Switch checked={useCurrentTime} onCheckedChange={(checked) => setControls({ useCurrentTime: checked })} />
                  <Text>{useCurrentTime ? "Use now" : "Use custom time"}</Text>
                </Flex>
                {!useCurrentTime ? (
                  <Flex gap="3">
                    <TextField.Root type="date" value={customDate} onChange={(event) => setControls({ customDate: event.target.value })} />
                    <TextField.Root type="time" value={customTime} onChange={(event) => setControls({ customTime: event.target.value })} />
                  </Flex>
                ) : null}
                <Button onClick={handleRewriteTimestamps} variant="soft">
                  <CalendarIcon /> Rewrite timestamps
                </Button>
              </Flex>
              <Separator size="4" />
              <Flex direction="column" gap="3">
                <Text size="2" color="gray">Precision range</Text>
                <SegmentedControl.Root value={precisionLevel} onValueChange={(value) => applyPrecisionRange(value as PrecisionLevel)}>
                  {PRECISION_PRESETS.map((preset) => (
                    <SegmentedControl.Item key={preset.value} value={preset.value} style={{ backgroundImage: preset.gradient }}>
                      {preset.label}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
                <Text size="1" color="gray">{precisionPreset.hint}</Text>
              </Flex>
            </Flex>
          </Grid>
          <Text size="1" color="gray">
            Use the controls to sculpt your payload, then run the ingest smoke test below. You can always edit the JSON directly if you need a bespoke shape.
          </Text>
        </Flex>
      </Card>

      <Card>
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <Heading as="h3" size="4">Ingest Pipeline Smoke Test</Heading>
            <Button onClick={handleSmokeTest} disabled={isRunning}>
              <RocketIcon /> {isRunning ? "Sending" : "Send smoke test"}
            </Button>
          </Flex>
          <Flex
            direction={{ initial: "column", sm: "row" }}
            gap="3"
            align={{ initial: "stretch", sm: "center" }}
            justify="between"
          >
            <Flex direction="column" gap="1">
              <Text size="2" color="gray">Batch visibility</Text>
              <Text size="1" color="gray">
                Default setting: {settings.defaultBatchVisibility === "public" ? "Public" : "Private"}
              </Text>
            </Flex>
            <SegmentedControl.Root
              value={batchVisibility}
              onValueChange={(value) => setControls({ batchVisibility: value as BatchVisibility })}
              style={{ alignSelf: "flex-start" }}
            >
              <SegmentedControl.Item value="public">Public</SegmentedControl.Item>
              <SegmentedControl.Item value="private">Private</SegmentedControl.Item>
            </SegmentedControl.Root>
          </Flex>
          <TextArea
            value={smokePayload}
            onChange={(event) => { setSmokePayload(event.target.value); setPayloadError(null); }}
            rows={12}
            style={{ fontFamily: "monospace" }}
          />
          {payloadError ? (
            <Callout.Root color="tomato">
              <Callout.Text>{payloadError}</Callout.Text>
            </Callout.Root>
          ) : null}
          {smokeError ? (
            <Callout.Root color="tomato">
              <Callout.Text>{smokeError}</Callout.Text>
            </Callout.Root>
          ) : null}
        </Flex>
      </Card>

      {smokeResult ? (
        <Card>
          <Flex direction="column" gap="2">
            <Heading as="h3" size="4">Latest ingest response</Heading>
            <Text size="2">Batch <code>{smokeResult.batchId}</code> stored at <code>{smokeResult.storagePath}</code></Text>
            <Flex gap="3" wrap="wrap" mt="2">
              <Badge variant="soft">Device: {smokeResult.deviceId}</Badge>
              <Badge variant="soft">Points inserted: {smokeResult.points?.length ?? smokeResult.payload?.points?.length ?? 0}</Badge>
              {renderVisibilityBadge(smokeResult.visibility)}
            </Flex>
            <Button mt="3" variant="surface" onClick={() => setSmokePayload(determinePayloadForEditor(smokeResult))}>
              <ReloadIcon /> Load payload into editor
            </Button>
          </Flex>
        </Card>
      ) : null}

      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h3" size="4">Recent smoke test runs</Heading>
          {smokeHistory.length === 0 ? (
            <Text color="gray">No smoke tests have been submitted yet in this browser.</Text>
          ) : (
            <ScrollArea type="always" style={{ maxHeight: 400 }}>
              <Flex direction="column" gap="3">
                {smokeHistory.map((entry) => {
                  const createdAtMs = timestampToMillis(entry.createdAt);
                  const createdAtLabel = createdAtMs === null ? "—" : new Date(createdAtMs).toLocaleString();
                  return (
                    <Card key={entry.id} variant="surface">
                      <Flex direction="column" gap="2">
                        <Text size="1" color="gray">{createdAtLabel}</Text>
                        <Flex gap="2" align="center" wrap="wrap">
                          <Text size="2">Batch <code>{entry.response.batchId}</code></Text>
                          {renderVisibilityBadge(entry.response.visibility)}
                        </Flex>
                        <Flex gap="2" wrap="wrap">
                          {entry.deviceIds.map((id) => (
                            <Badge key={id} variant="soft">{id}</Badge>
                          ))}
                        </Flex>
                        <Flex gap="2" wrap="wrap" mt="2">
                          <Button variant="soft" onClick={() => loadHistoryPayload(entry)}>
                            <ReloadIcon /> Load payload
                          </Button>
                          <Button
                            variant="soft"
                            color="red"
                            onClick={() => handleHistoryCleanup(entry)}
                            disabled={deletingDeviceId === entry.deviceIds[0]}
                          >
                            <TrashIcon /> {deletingDeviceId === entry.deviceIds[0] ? "Deleting" : "Delete data"}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleBatchCleanup(entry)}
                            disabled={deletingBatchId === entry.response.batchId}
                          >
                            <TrashIcon /> {deletingBatchId === entry.response.batchId ? "Removing" : "Remove from history"}
                          </Button>
                        </Flex>
                      </Flex>
                    </Card>
                  );
                })}
              </Flex>
            </ScrollArea>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
