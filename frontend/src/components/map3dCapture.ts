import { logWarning } from "../lib/logger";
import { canCaptureCanvas } from "../lib/videoExport";

export type Map3DCaptureSession = {
  canvas: HTMLCanvasElement;
  requestFrame: () => void;
  stop: () => void;
};

export type Map3DCaptureOptions = {
  watermarkText?: string | null;
  captureFps?: number;
  frameOverlayLines?: () => string[];
};

function getVisibleCanvases(root: HTMLDivElement | null): HTMLCanvasElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll("canvas")).filter((canvas): canvas is HTMLCanvasElement => {
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const style = window.getComputedStyle(canvas);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(canvas.width, Math.round(rect.width));
    const height = Math.max(canvas.height, Math.round(rect.height));
    return width > 0 && height > 0;
  });
}

export function pickLargestCaptureCanvas(root: HTMLDivElement | null): HTMLCanvasElement | null {
  if (!root) return null;

  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;

  getVisibleCanvases(root).forEach((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || !canCaptureCanvas(canvas)) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(canvas.width, Math.round(rect.width));
    const height = Math.max(canvas.height, Math.round(rect.height));
    const area = width * height;
    if (area >= bestArea) {
      best = canvas;
      bestArea = area;
    }
  });

  return best;
}

function compareCanvasOrder(left: HTMLCanvasElement, right: HTMLCanvasElement): number {
  const leftZ = Number.parseInt(window.getComputedStyle(left).zIndex || "0", 10);
  const rightZ = Number.parseInt(window.getComputedStyle(right).zIndex || "0", 10);
  const safeLeftZ = Number.isFinite(leftZ) ? leftZ : 0;
  const safeRightZ = Number.isFinite(rightZ) ? rightZ : 0;
  if (safeLeftZ !== safeRightZ) return safeLeftZ - safeRightZ;

  const relation = left.compareDocumentPosition(right);
  if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
  watermarkText: string,
) {
  const safeText = watermarkText.trim();
  if (!safeText) return;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);
  const fontSize = Math.max(14, Math.round(Math.min(canvas.width / dpr, canvas.height / dpr) * 0.028));
  const paddingX = fontSize * 0.8;
  const paddingY = fontSize * 0.55;
  const x = (canvas.width / dpr) - paddingX;
  const y = (canvas.height / dpr) - paddingY;
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "bottom";
  const metrics = context.measureText(safeText);
  const boxWidth = metrics.width + fontSize * 1.1;
  const boxHeight = fontSize * 1.9;
  context.fillStyle = "rgba(0, 0, 0, 0.52)";
  context.beginPath();
  context.roundRect(x - boxWidth, y - boxHeight + 4, boxWidth, boxHeight, 8);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fillText(safeText, x - fontSize * 0.55, y - fontSize * 0.35);
  context.restore();
}

function getFrameOverlayLines(options?: Map3DCaptureOptions): string[] {
  if (!options?.frameOverlayLines) return [];

  try {
    return options.frameOverlayLines()
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 6);
  }
  catch (err) {
    logWarning("Unable to render video export frame overlay.", undefined, err);
    return [];
  }
}

function fitCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;

  const ellipsis = "...";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (context.measureText(candidate).width <= maxWidth) {
      low = mid;
    }
    else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
}

function drawFrameOverlay(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
  lines: string[],
) {
  if (!lines.length) return;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);

  const widthCss = canvas.width / dpr;
  const heightCss = canvas.height / dpr;
  const fontSize = Math.max(12, Math.round(Math.min(widthCss, heightCss) * 0.023));
  const lineHeight = Math.round(fontSize * 1.35);
  const paddingX = Math.round(fontSize * 0.85);
  const paddingY = Math.round(fontSize * 0.7);
  const margin = Math.max(10, Math.round(fontSize * 0.8));
  const maxTextWidth = Math.max(180, widthCss - (margin * 2) - (paddingX * 2));

  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  const fittedLines = lines.map((line) => fitCanvasText(context, line, maxTextWidth));
  const boxWidth = Math.min(
    widthCss - (margin * 2),
    Math.max(...fittedLines.map((line) => context.measureText(line).width)) + (paddingX * 2)
  );
  const boxHeight = (lineHeight * fittedLines.length) + (paddingY * 2);
  const x = margin;
  const y = margin;

  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  context.beginPath();
  context.roundRect(x, y, boxWidth, boxHeight, 10);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.textAlign = "left";
  context.textBaseline = "top";

  fittedLines.forEach((line, index) => {
    context.font = index === 0
      ? `700 ${fontSize}px system-ui, sans-serif`
      : `500 ${Math.max(11, fontSize - 1)}px system-ui, sans-serif`;
    context.fillText(line, x + paddingX, y + paddingY + (index * lineHeight));
  });
  context.restore();
}

function createCompositeCaptureSession(root: HTMLDivElement | null, options?: Map3DCaptureOptions): Map3DCaptureSession | null {
  if (!root) return null;

  const canvases = getVisibleCanvases(root).sort(compareCanvasOrder);
  if (!canvases.length) return null;

  const rootRect = root.getBoundingClientRect();
  const fallbackCanvas = canvases.reduce<HTMLCanvasElement | null>((best, current) => {
    if (!best) return current;
    const bestRect = best.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    return (currentRect.width * currentRect.height) > (bestRect.width * bestRect.height) ? current : best;
  }, null);
  const fallbackRect = fallbackCanvas?.getBoundingClientRect() ?? null;
  const widthCss = Math.max(Math.round(rootRect.width), Math.round(fallbackRect?.width ?? 0));
  const heightCss = Math.max(Math.round(rootRect.height), Math.round(fallbackRect?.height ?? 0));
  if (widthCss <= 0 || heightCss <= 0) return null;

  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = Math.max(1, Math.round(widthCss * dpr));
  compositeCanvas.height = Math.max(1, Math.round(heightCss * dpr));
  compositeCanvas.style.width = `${widthCss}px`;
  compositeCanvas.style.height = `${heightCss}px`;

  const context = compositeCanvas.getContext("2d");
  if (!context) return null;
  const stagingCanvas = document.createElement("canvas");
  stagingCanvas.width = compositeCanvas.width;
  stagingCanvas.height = compositeCanvas.height;
  const stagingContext = stagingCanvas.getContext("2d");
  if (!stagingContext) return null;

  let disposed = false;
  let rafId = 0;

  const drawFrame = () => {
    if (disposed) return;

    const currentRootRect = root.getBoundingClientRect();
    const originLeft = currentRootRect.width > 0 ? currentRootRect.left : (fallbackRect?.left ?? 0);
    const originTop = currentRootRect.height > 0 ? currentRootRect.top : (fallbackRect?.top ?? 0);
    const currentCanvases = getVisibleCanvases(root)
      .sort(compareCanvasOrder)
      .filter((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;
      });
    if (!currentCanvases.length) return;

    stagingContext.setTransform(1, 0, 0, 1, 0, 0);
    stagingContext.clearRect(0, 0, stagingCanvas.width, stagingCanvas.height);
    stagingContext.scale(dpr, dpr);

    let drewFrame = false;
    currentCanvases.forEach((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const dx = rect.left - originLeft;
      const dy = rect.top - originTop;
      try {
        stagingContext.drawImage(canvas, dx, dy, rect.width, rect.height);
        drewFrame = true;
      }
      catch (err) {
        logWarning("Unable to composite map canvas layer for export.", {
          width: rect.width,
          height: rect.height
        }, err);
      }
    });
    if (!drewFrame) return;
    drawFrameOverlay(stagingContext, stagingCanvas, dpr, getFrameOverlayLines(options));
    if (options?.watermarkText) {
      drawWatermark(stagingContext, stagingCanvas, dpr, options.watermarkText);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    context.drawImage(stagingCanvas, 0, 0);
  };

  const scheduleFrame = () => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(() => {
      drawFrame();
      scheduleFrame();
    });
  };

  drawFrame();
  scheduleFrame();

  return {
    canvas: compositeCanvas,
    requestFrame: drawFrame,
    stop: () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    },
  };
}

function createDirectCanvasCaptureSession(root: HTMLDivElement | null): Map3DCaptureSession | null {
  const canvas = pickLargestCaptureCanvas(root);
  if (!canvas || !canCaptureCanvas(canvas)) return null;

  return {
    canvas,
    requestFrame: () => {},
    stop: () => {},
  };
}

async function createStreamBackedCaptureSession(
  root: HTMLDivElement | null,
  options?: Map3DCaptureOptions & { allowCompositeFallback?: boolean }
): Promise<Map3DCaptureSession | null> {
  if (!root) return null;
  const allowCompositeFallback = options?.allowCompositeFallback ?? true;

  const canvases = getVisibleCanvases(root).sort(compareCanvasOrder);
  if (!canvases.length) return null;

  const baseCanvas = pickLargestCaptureCanvas(root);
  if (!baseCanvas || !canCaptureCanvas(baseCanvas)) {
    return allowCompositeFallback ? createCompositeCaptureSession(root, options) : null;
  }

  const rootRect = root.getBoundingClientRect();
  const baseRect = baseCanvas.getBoundingClientRect();
  const widthCss = Math.max(Math.round(rootRect.width), Math.round(baseRect.width));
  const heightCss = Math.max(Math.round(rootRect.height), Math.round(baseRect.height));
  if (widthCss <= 0 || heightCss <= 0) return null;

  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = Math.max(1, Math.round(widthCss * dpr));
  compositeCanvas.height = Math.max(1, Math.round(heightCss * dpr));
  compositeCanvas.style.width = `${widthCss}px`;
  compositeCanvas.style.height = `${heightCss}px`;

  const context = compositeCanvas.getContext("2d");
  if (!context) return null;
  const stagingCanvas = document.createElement("canvas");
  stagingCanvas.width = compositeCanvas.width;
  stagingCanvas.height = compositeCanvas.height;
  const stagingContext = stagingCanvas.getContext("2d");
  if (!stagingContext) return null;

  let baseStream: MediaStream;
  try {
    baseStream = baseCanvas.captureStream(options?.captureFps ?? 30);
  }
  catch {
    return allowCompositeFallback ? createCompositeCaptureSession(root, options) : null;
  }

  const baseVideo = document.createElement("video");
  baseVideo.muted = true;
  baseVideo.playsInline = true;
  baseVideo.autoplay = true;
  baseVideo.srcObject = baseStream;

  try {
    await baseVideo.play();
  }
  catch {
    baseStream.getTracks().forEach((track) => track.stop());
    return allowCompositeFallback ? createCompositeCaptureSession(root, options) : null;
  }

  let disposed = false;
  let rafId = 0;

  const drawFrame = () => {
    if (disposed) return;

    const currentRootRect = root.getBoundingClientRect();
    const originLeft = currentRootRect.width > 0 ? currentRootRect.left : baseRect.left;
    const originTop = currentRootRect.height > 0 ? currentRootRect.top : baseRect.top;

    stagingContext.setTransform(1, 0, 0, 1, 0, 0);
    stagingContext.clearRect(0, 0, stagingCanvas.width, stagingCanvas.height);
    stagingContext.scale(dpr, dpr);

    let drewFrame = false;
    const currentBaseRect = baseCanvas.getBoundingClientRect();
    const baseDx = currentBaseRect.left - originLeft;
    const baseDy = currentBaseRect.top - originTop;
    if (
      baseVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && currentBaseRect.width > 0
      && currentBaseRect.height > 0
      && baseVideo.videoWidth > 0
      && baseVideo.videoHeight > 0
    ) {
      try {
        stagingContext.drawImage(baseVideo, baseDx, baseDy, currentBaseRect.width, currentBaseRect.height);
        drewFrame = true;
      }
      catch (err) {
        logWarning("Unable to composite streamed map canvas layer for export.", {
          width: currentBaseRect.width,
          height: currentBaseRect.height
        }, err);
      }
    }

    getVisibleCanvases(root).sort(compareCanvasOrder).forEach((canvas) => {
      if (canvas === baseCanvas) return;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width <= 0 || canvas.height <= 0 || rect.width <= 0 || rect.height <= 0) return;
      const dx = rect.left - originLeft;
      const dy = rect.top - originTop;
      try {
        stagingContext.drawImage(canvas, dx, dy, rect.width, rect.height);
        drewFrame = true;
      }
      catch (err) {
        logWarning("Unable to composite map canvas layer for export.", {
          width: rect.width,
          height: rect.height
        }, err);
      }
    });
    if (!drewFrame) return;
    drawFrameOverlay(stagingContext, stagingCanvas, dpr, getFrameOverlayLines(options));
    if (options?.watermarkText) {
      drawWatermark(stagingContext, stagingCanvas, dpr, options.watermarkText);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    context.drawImage(stagingCanvas, 0, 0);
  };

  const scheduleFrame = () => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(() => {
      drawFrame();
      scheduleFrame();
    });
  };

  drawFrame();
  scheduleFrame();

  return {
    canvas: compositeCanvas,
    requestFrame: drawFrame,
    stop: () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      baseVideo.pause();
      baseVideo.srcObject = null;
      baseStream.getTracks().forEach((track) => track.stop());
    },
  };
}

export async function createCaptureSession(
  root: HTMLDivElement | null,
  options?: Map3DCaptureOptions & { preferDirectCanvas?: boolean }
): Promise<Map3DCaptureSession | null> {
  const needsCompositedOverlay = Boolean(options?.watermarkText || options?.frameOverlayLines);
  if (needsCompositedOverlay) {
    return createStreamBackedCaptureSession(root, {
      allowCompositeFallback: true,
      watermarkText: options?.watermarkText,
      captureFps: options?.captureFps,
      frameOverlayLines: options?.frameOverlayLines,
    });
  }
  if (options?.preferDirectCanvas) {
    return createDirectCanvasCaptureSession(root)
      ?? createStreamBackedCaptureSession(root, {
        allowCompositeFallback: false,
        captureFps: options.captureFps,
      });
  }
  return createStreamBackedCaptureSession(root, { captureFps: options?.captureFps });
}
