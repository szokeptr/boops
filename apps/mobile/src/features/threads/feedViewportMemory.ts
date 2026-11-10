import Storage from "expo-sqlite/kv-store";

export interface FeedViewport {
  readonly splitLayout: boolean;
  readonly windowWidth: number;
  readonly width: number;
  readonly height: number;
}

const STORAGE_KEY = "thread-feed-viewport";

let remembered: FeedViewport | null | undefined;

function readStored(): FeedViewport | null {
  try {
    const raw = Storage.getItemSync(STORAGE_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { splitLayout, windowWidth, width, height } = value as Record<string, unknown>;
    return typeof splitLayout === "boolean" &&
      typeof windowWidth === "number" &&
      typeof width === "number" &&
      typeof height === "number"
      ? { splitLayout, windowWidth, width, height }
      : null;
  } catch {
    return null;
  }
}

/**
 * The size the last thread feed measured, kept across launches. A split pane's first layout
 * after launch reports the full window before it settles, so the first thread opened would
 * otherwise wait for its real width.
 */
export function rememberedFeedViewport(): FeedViewport | null {
  if (remembered === undefined) remembered = readStored();
  return remembered;
}

export function rememberFeedViewport(viewport: FeedViewport) {
  const previous = rememberedFeedViewport();
  remembered = viewport;
  if (
    previous?.splitLayout === viewport.splitLayout &&
    previous.windowWidth === viewport.windowWidth &&
    previous.width === viewport.width &&
    previous.height === viewport.height
  )
    return;
  void Storage.setItem(STORAGE_KEY, JSON.stringify(viewport)).catch(() => {});
}
