export type BatchKeyParts = { deviceId: string; batchId: string };

export function encodeBatchKey(deviceId: string, batchId: string): string {
  return `${deviceId}::${batchId}`;
}

export function decodeBatchKey(value: string | null | undefined): BatchKeyParts | null {
  if (!value) return null;
  const separator = value.indexOf("::");
  if (separator === -1) return null;
  const deviceId = value.slice(0, separator);
  const batchId = value.slice(separator + 2);
  if (!deviceId || !batchId) return null;
  return { deviceId, batchId };
}
