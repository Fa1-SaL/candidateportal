import type { createSessionGuard } from "./session-guard";

// Browser focus, visibility and pageshow events can describe one return to a
// page. This short window coalesces those events, not the age of source data.
const EVENT_WINDOW_MS = 250;

export function createSessionLifecycle(options: {
  guard: ReturnType<typeof createSessionGuard>;
  refresh: () => void;
  initiallyVisible: boolean;
  now?: () => number;
}) {
  const now = options.now ?? (() => performance.now());
  let visible = options.initiallyVisible;
  let suspended = false;
  let disposed = false;
  let generation = 0;
  let inFlight: Promise<void> | null = null;
  let refreshPending = false;
  let awaitingPageShow = false;
  let lastVerifiedAt = -Infinity;
  let lastRefreshAt = -Infinity;

  function conceal() {
    generation++;
    inFlight = null;
    lastVerifiedAt = -Infinity;
    options.guard.pause();
  }
  function hide() {
    if (disposed) return;
    if (visible) {
      visible = false;
      refreshPending = true;
      lastRefreshAt = -Infinity;
      conceal();
    }
  }
  function verify(force = false): Promise<void> {
    if (disposed || suspended || !visible) return Promise.resolve();
    if (inFlight) return inFlight;
    if (!force && now() - lastVerifiedAt < EVENT_WINDOW_MS) return Promise.resolve();
    const request = generation;
    const checked = options.guard.check(() => {
      if (disposed || suspended || !visible || request !== generation) return;
      lastVerifiedAt = now();
      if (refreshPending) {
        refreshPending = false;
        lastRefreshAt = now();
        options.refresh();
      }
    });
    inFlight = checked.finally(() => {
      if (request === generation) inFlight = null;
    });
    return inFlight;
  }
  function show(isVisible: boolean) {
    if (!isVisible) { hide(); return Promise.resolve(); }
    if (!visible) {
      visible = true;
      refreshPending = true;
    }
    return verify();
  }
  return {
    start: () => verify(true),
    focus: show,
    visibilityChanged: show,
    pageHide() {
      awaitingPageShow = true;
      hide();
    },
    pageShow(persisted: boolean, isVisible: boolean) {
      // A BFCache restore can occur without an observed visibility transition.
      // A preceding pagehide already queued the same refresh, even when focus
      // or visibilitychange completed its identity check before pageshow.
      if (persisted && !awaitingPageShow && now() - lastRefreshAt >= EVENT_WINDOW_MS) {
        refreshPending = true;
        lastVerifiedAt = -Infinity;
      }
      awaitingPageShow = false;
      return show(isVisible);
    },
    suspend() {
      suspended = true;
      conceal();
    },
    retry() {
      suspended = false;
      return verify(true);
    },
    dispose() {
      disposed = true;
      generation++;
      inFlight = null;
      options.guard.dispose();
    },
  };
}
