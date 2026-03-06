export const PREFERRED_WEBM_MIME_TYPES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export type CanvasVideoExportSupport = {
  supported: boolean;
  mimeType: string | null;
  reason: string | null;
};

export type CanvasRecordingSession = {
  mimeType: string;
  stop: () => Promise<Blob>;
};

export function detectCanvasVideoExportSupport(): CanvasVideoExportSupport {
  if (typeof MediaRecorder === "undefined") {
    return {
      supported: false,
      mimeType: null,
      reason: "This browser does not support MediaRecorder video export.",
    };
  }
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return {
      supported: false,
      mimeType: null,
      reason: "This browser cannot negotiate a supported WebM export format.",
    };
  }

  const mimeType = PREFERRED_WEBM_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null;
  if (!mimeType) {
    return {
      supported: false,
      mimeType: null,
      reason: "This browser does not support the required WebM video formats.",
    };
  }

  return {
    supported: true,
    mimeType,
    reason: null,
  };
}

export function canCaptureCanvas(canvas: HTMLCanvasElement | null | undefined): canvas is HTMLCanvasElement {
  if (!canvas) return false;
  if (typeof canvas.captureStream !== "function") return false;

  const rect = canvas.getBoundingClientRect();
  const width = Math.max(canvas.width, Math.round(rect.width));
  const height = Math.max(canvas.height, Math.round(rect.height));
  return width > 0 && height > 0;
}

export function startCanvasRecording(
  canvas: HTMLCanvasElement,
  options?: { fps?: number; mimeType?: string }
): CanvasRecordingSession {
  if (!canCaptureCanvas(canvas)) {
    throw new Error("The live map canvas is not ready for capture.");
  }

  const support = detectCanvasVideoExportSupport();
  const mimeType = options?.mimeType ?? support.mimeType;
  if (!mimeType || !support.supported) {
    throw new Error(support.reason ?? "Video export is not supported in this browser.");
  }

  let stream: MediaStream;
  try {
    stream = canvas.captureStream(options?.fps ?? 30);
  }
  catch (err) {
    const message = err instanceof Error ? err.message : "Unable to capture the live map canvas.";
    throw new Error(message);
  }

  if (!stream.getVideoTracks().length) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("The live map canvas did not expose a video track for recording.");
  }

  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType });
  }
  catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    const message = err instanceof Error ? err.message : "Unable to initialize video recording.";
    throw new Error(message);
  }
  const chunks: BlobPart[] = [];

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  try {
    recorder.start();
  }
  catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    const message = err instanceof Error ? err.message : "Unable to start video recording.";
    throw new Error(message);
  }

  return {
    mimeType,
    stop: () => new Promise<Blob>((resolve, reject) => {
      const cleanup = () => {
        stream.getTracks().forEach((track) => track.stop());
      };

      const handleStop = () => {
        cleanup();
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (!blob.size) {
          reject(new Error("The recorded video was empty."));
          return;
        }
        resolve(blob);
      };

      const handleError = (event: Event) => {
        cleanup();
        const mediaEvent = event as Event & { error?: { message?: string } };
        reject(new Error(mediaEvent.error?.message ?? "Video recording failed."));
      };

      recorder.addEventListener("stop", handleStop, { once: true });
      recorder.addEventListener("error", handleError, { once: true });

      if (recorder.state === "inactive") {
        cleanup();
        reject(new Error("The video recorder was not active."));
        return;
      }

      try {
        recorder.stop();
      }
      catch (err) {
        cleanup();
        const message = err instanceof Error ? err.message : "Unable to stop video recording.";
        reject(new Error(message));
      }
    }),
  };
}
