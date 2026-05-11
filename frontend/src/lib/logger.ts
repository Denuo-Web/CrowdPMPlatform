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

function buildPayload(context?: LogContext, err?: unknown): LogContext | undefined {
  const error = serializeError(err);
  const payload = {
    ...context,
    ...(error ? { error } : {})
  };
  return Object.keys(payload).length ? payload : undefined;
}

export function logWarning(message: string, context?: LogContext, err?: unknown): void {
  const payload = buildPayload(context, err);
  if (payload) {
    console.warn(`[CrowdPM] ${message}`, payload);
    return;
  }
  console.warn(`[CrowdPM] ${message}`);
}

export function logError(message: string, context?: LogContext, err?: unknown): void {
  const payload = buildPayload(context, err);
  if (payload) {
    console.error(`[CrowdPM] ${message}`, payload);
    return;
  }
  console.error(`[CrowdPM] ${message}`);
}
