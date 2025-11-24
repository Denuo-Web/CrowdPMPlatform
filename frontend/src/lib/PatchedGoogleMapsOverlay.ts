import type {Deck} from "@deck.gl/core";
import {
  GoogleMapsOverlay as BaseOverlay,
  type GoogleMapsOverlayProps
} from "@deck.gl/google-maps";

type FramebufferLike =
  | null
  | WebGLFramebuffer
  | {
      handle?: WebGLFramebuffer | null;
      colorAttachments?: unknown;
      width?: number;
      height?: number;
    };

type FramebufferShim = {
  handle: WebGLFramebuffer;
  colorAttachments: [null];
  width: number;
  height: number;
};

/**
 * Wraps GoogleMapsOverlay so deck.gl always receives framebuffers with the metadata luma.gl expects.
 */
export default class PatchedGoogleMapsOverlay extends BaseOverlay {
  private glContext: WebGL2RenderingContext | null = null;
  private framebufferShim: FramebufferShim | null = null;

  constructor(props: GoogleMapsOverlayProps) {
    super(props);
  }

  protected override _onContextRestored(args: { gl: WebGL2RenderingContext }) {
    this.glContext = args.gl;
    this.framebufferShim = null;

    super._onContextRestored(args);
    this.patchDeckFramebuffer();
  }

  private patchDeckFramebuffer() {
    const deck = (this as unknown as { _deck?: Deck | null })._deck;
    if (!deck || !this.glContext) return;

    const augmentedDeck = deck as Deck & { __framebufferShimApplied?: boolean };
    if (augmentedDeck.__framebufferShimApplied) return;

    const originalSetProps = deck.setProps.bind(deck);
    const wrap = this.wrapFramebuffer.bind(this);

    deck.setProps = ((props) => {
      if (props && typeof props === "object" && "_framebuffer" in props) {
        const rawFramebuffer = (props as { _framebuffer?: FramebufferLike })._framebuffer ?? null;
        const patchedFramebuffer = wrap(rawFramebuffer);
        if (patchedFramebuffer === rawFramebuffer) {
          return originalSetProps(props);
        }
        const nextProps = {
          ...(props as Record<string, unknown>),
          _framebuffer: patchedFramebuffer
        };
        return originalSetProps(nextProps);
      }
      return originalSetProps(props);
    }) as typeof deck.setProps;

    augmentedDeck.__framebufferShimApplied = true;
  }

  private wrapFramebuffer(input: FramebufferLike): FramebufferLike {
    if (!input) return input;
    if (typeof input === "object" && "colorAttachments" in input) {
      if (this.glContext) {
        (input as { width?: number; height?: number }).width = this.glContext.drawingBufferWidth;
        (input as { width?: number; height?: number }).height = this.glContext.drawingBufferHeight;
      }
      return input;
    }
    if (!this.glContext) return input;

    const handle = input as WebGLFramebuffer;
    const width = this.glContext.drawingBufferWidth;
    const height = this.glContext.drawingBufferHeight;

    if (!this.framebufferShim || this.framebufferShim.handle !== handle) {
      this.framebufferShim = {
        handle,
        colorAttachments: [null],
        width,
        height
      };
    } else {
      this.framebufferShim.width = width;
      this.framebufferShim.height = height;
    }

    return this.framebufferShim;
  }
}
