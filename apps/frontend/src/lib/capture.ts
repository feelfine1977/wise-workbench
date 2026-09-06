/**
 * Client-side capture of a screen for the notebook (R2-O11): the DOM is rasterised with html-to-image,
 * which copies the ECharts canvases and the process map's SVG. When that fails (a tainted canvas, an
 * unsupported browser) the caller sends the context only and the backend renders the screen itself.
 */
export interface CaptureOptions {
  /** Longest edge in CSS pixels; larger screens are scaled down. */
  maxEdge?: number;
}

export async function captureElement(el: HTMLElement, options: CaptureOptions = {}): Promise<Blob | undefined> {
  if (typeof window === "undefined" || typeof document === "undefined") return undefined;
  try {
    const { toBlob } = await import("html-to-image");
    const rect = el.getBoundingClientRect();
    const longest = Math.max(rect.width, rect.height, 1);
    const maxEdge = options.maxEdge ?? 2400;
    const ratio = Math.min(2, Math.max(1, (window.devicePixelRatio || 1) * Math.min(1, maxEdge / longest)));
    const background = getComputedStyle(document.body).backgroundColor || "#ffffff";
    const blob = await toBlob(el, {
      cacheBust: true,
      pixelRatio: ratio,
      backgroundColor: background,
      filter: (node) => !(node instanceof HTMLElement && node.dataset.noCapture !== undefined),
    });
    return blob ?? undefined;
  } catch {
    return undefined;
  }
}

/** The element a "Freeze this" button captures: the screen's main region. */
export function screenElement(): HTMLElement | null {
  return document.getElementById("main");
}
