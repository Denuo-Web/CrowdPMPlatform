import type { GoogleMapsOverlay } from "@deck.gl/google-maps";

type FramebufferWrapperLike = {
  width: number;
  height: number;
  destroy: () => void;
};

type WebGLDeviceLike = {
  gl?: { canvas?: { width?: number; height?: number } };
  createFramebuffer: (props: {
    handle: WebGLFramebuffer;
    width: number;
    height: number;
  }) => FramebufferWrapperLike;
};

type DeckLike = {
  device?: unknown;
  setProps: (props: Record<string, unknown>) => void;
};

type ExternalFramebufferState = {
  handle: WebGLFramebuffer;
  wrapper: FramebufferWrapperLike;
};

type PatchedDeck = DeckLike & {
  __crowdpmFramebufferSetPropsPatched?: boolean;
};

type GoogleMapsOverlayInternal = GoogleMapsOverlay & {
  _deck?: DeckLike | null;
  _onAdd?: () => void;
  _onAddVectorOverlay?: () => void;
  _onContextRestored?: (event: { gl: WebGL2RenderingContext }) => void;
  _onContextLost?: () => void;
  __crowdpmExternalFramebuffer?: ExternalFramebufferState | null;
  __crowdpmExternalFramebufferPatched?: boolean;
  finalize: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isWebGLDeviceLike(value: unknown): value is WebGLDeviceLike {
  return isRecord(value) && typeof value.createFramebuffer === "function";
}

function isRawExternalFramebufferHandle(value: unknown): value is WebGLFramebuffer {
  return isRecord(value)
    && !("width" in value)
    && !("height" in value)
    && !("colorAttachments" in value);
}

function destroyExternalFramebuffer(overlay: GoogleMapsOverlayInternal) {
  overlay.__crowdpmExternalFramebuffer?.wrapper.destroy();
  overlay.__crowdpmExternalFramebuffer = null;
}

function getExternalFramebufferSize(device: WebGLDeviceLike) {
  const width = Math.max(Math.round(Number(device.gl?.canvas?.width ?? 0)), 1);
  const height = Math.max(Math.round(Number(device.gl?.canvas?.height ?? 0)), 1);
  return { width, height };
}

function wrapExternalFramebuffer(
  overlay: GoogleMapsOverlayInternal,
  device: WebGLDeviceLike,
  handle: WebGLFramebuffer
) {
  const { width, height } = getExternalFramebufferSize(device);
  const current = overlay.__crowdpmExternalFramebuffer;

  if (current?.handle === handle) {
    current.wrapper.width = width;
    current.wrapper.height = height;
    return current.wrapper;
  }

  destroyExternalFramebuffer(overlay);
  const wrapper = device.createFramebuffer({ handle, width, height });
  overlay.__crowdpmExternalFramebuffer = { handle, wrapper };
  return wrapper;
}

function patchDeckSetProps(overlay: GoogleMapsOverlayInternal, deck: DeckLike | null | undefined) {
  if (!deck) return;

  const patchedDeck = deck as PatchedDeck;
  if (patchedDeck.__crowdpmFramebufferSetPropsPatched) return;

  const originalSetProps = deck.setProps.bind(deck);
  patchedDeck.__crowdpmFramebufferSetPropsPatched = true;

  deck.setProps = (props) => {
    if (!Object.prototype.hasOwnProperty.call(props, "_framebuffer")) {
      originalSetProps(props);
      return;
    }

    const device = deck.device;
    if (!isWebGLDeviceLike(device)) {
      originalSetProps(props);
      return;
    }

    const framebufferProp = props._framebuffer;
    if (!framebufferProp) {
      destroyExternalFramebuffer(overlay);
      originalSetProps(props);
      return;
    }

    if (!isRawExternalFramebufferHandle(framebufferProp)) {
      originalSetProps(props);
      return;
    }

    originalSetProps({
      ...props,
      _framebuffer: wrapExternalFramebuffer(overlay, device, framebufferProp)
    });
  };
}

function patchOverlayHook(
  overlay: GoogleMapsOverlayInternal,
  key: "_onAdd" | "_onAddVectorOverlay" | "_onContextRestored" | "_onContextLost",
  after: () => void
) {
  const original = overlay[key];
  if (typeof original !== "function") return;

  overlay[key] = ((...args: unknown[]) => {
    const result = original.apply(overlay, args as never);
    after();
    return result;
  }) as GoogleMapsOverlayInternal[typeof key];
}

// TODO: Remove after a released `@deck.gl/google-maps` includes deck.gl PR #10253.
export function patchGoogleMapsOverlayExternalFramebuffer(overlay: GoogleMapsOverlay) {
  const internalOverlay = overlay as GoogleMapsOverlayInternal;
  if (internalOverlay.__crowdpmExternalFramebufferPatched) return;
  internalOverlay.__crowdpmExternalFramebufferPatched = true;

  patchOverlayHook(internalOverlay, "_onAdd", () => {
    patchDeckSetProps(internalOverlay, internalOverlay._deck);
  });
  patchOverlayHook(internalOverlay, "_onAddVectorOverlay", () => {
    patchDeckSetProps(internalOverlay, internalOverlay._deck);
  });
  patchOverlayHook(internalOverlay, "_onContextRestored", () => {
    patchDeckSetProps(internalOverlay, internalOverlay._deck);
  });
  patchOverlayHook(internalOverlay, "_onContextLost", () => {
    destroyExternalFramebuffer(internalOverlay);
  });

  const originalFinalize = internalOverlay.finalize.bind(overlay);
  internalOverlay.finalize = () => {
    destroyExternalFramebuffer(internalOverlay);
    originalFinalize();
  };

  patchDeckSetProps(internalOverlay, internalOverlay._deck);
}

export function disposeGoogleMapsOverlayExternalFramebuffer(overlay: GoogleMapsOverlay | null) {
  if (!overlay) return;
  destroyExternalFramebuffer(overlay as GoogleMapsOverlayInternal);
}
