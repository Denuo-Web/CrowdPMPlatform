export type LogContext = Record<string, unknown>;

function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (typeof err === "object") {
    return { ...err as Record<string, unknown> };
  }
  return { error: err };
}

export function logWarning(message: string, context?: LogContext, err?: unknown): void {
  const payload = { ...context, error: serializeError(err) };
  // eslint-disable-next-line no-console
  console.warn(`[CrowdPM] ${message}`, payload);
}
