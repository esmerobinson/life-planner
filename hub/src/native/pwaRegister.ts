import { registerSW } from "virtual:pwa-register";
import { NATIVE_FLUSH, NATIVE_PREPARE_RELOAD, type PrepareResult } from "./appUpdate";
import { createAutoUpdater, justSwitched, noteSwitched, setAppUpdater } from "./pwaUpdate";
import { addUpdateHold, currentUpdateHold, installEditTracker, userActivity } from "./updateHolds";
import { syncController } from "../sync";
import { togetherRunner } from "../together/runner";

/** The Mac app serves the web app from esmeworld://app/ (mac/Esmeworld/main.swift). */
const MAC_APP_PROTOCOL = "esmeworld:";
/** At a cold open, how long the app's first paint may wait for a waiting version to take over. */
export const FIRST_PAINT_WAIT_MS = 1_500;

type SW = Pick<ServiceWorkerContainer, "controller" | "getRegistration" | "addEventListener" | "removeEventListener">;

/**
 * At a cold open, before the app is drawn (main.tsx): if a new version is already waiting, let it
 * take over and reload onto it, so opening the app never shows the old one and then flashes.
 * Nothing can have been typed yet. Resolves true when the page is reloading (do not draw), false
 * to draw the app now (nothing waiting, or the takeover was slow: the safe path takes it later).
 */
export async function applyWaitingBeforeFirstPaint(
  opts: { sw?: SW | undefined; reload?: () => void; protocol?: string; timeoutMs?: number } = {},
): Promise<boolean> {
  const sw = "sw" in opts ? opts.sw : (navigator.serviceWorker as SW | undefined);
  const reload = opts.reload ?? (() => window.location.reload());
  const protocol = opts.protocol ?? window.location.protocol;
  // The Mac app reloads by itself; an uncontrolled page gets no takeover event; just switched: the note.
  if (!sw?.controller || protocol === MAC_APP_PROTOCOL || justSwitched()) return false;
  let waiting: ServiceWorker | null | undefined;
  try {
    // Bounded: the first paint never waits long on the browser.
    const reg = await Promise.race([
      sw.getRegistration(),
      new Promise<undefined>((r) => setTimeout(() => r(undefined), opts.timeoutMs ?? FIRST_PAINT_WAIT_MS)),
    ]);
    waiting = reg?.waiting;
  } catch {
    return false;
  }
  if (!waiting) return false;
  return new Promise<boolean>((resolve) => {
    const onTakeover = () => {
      clearTimeout(timer);
      sw.removeEventListener("controllerchange", onTakeover);
      reload();
      resolve(true);
    };
    const timer = setTimeout(() => {
      sw.removeEventListener("controllerchange", onTakeover);
      resolve(false);
    }, opts.timeoutMs ?? FIRST_PAINT_WAIT_MS);
    sw.addEventListener("controllerchange", onTakeover);
    noteSwitched();
    waiting.postMessage({ type: "SKIP_WAITING" });
  });
}

/**
 * Registers the service worker and starts the automatic updates (pwaUpdate.ts), from main.tsx.
 * Returns a function that stops them (tests).
 */
export function startPwaUpdates(where: { protocol: string } = window.location): () => void {
  const w = window as unknown as Record<string, unknown>;
  let registration: ServiceWorkerRegistration | undefined;
  let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;
  const stopTracking = installEditTracker(document);

  const updater = createAutoUpdater({
    // In the Mac app its shell reloads onto new versions itself: never fight it.
    auto: where.protocol !== MAC_APP_PROTOCOL,
    check: async () => {
      await registration?.update();
    },
    activate: () => updateSW?.(true),
    reload: () => window.location.reload(),
    // The Mac app's own check: not while typing; saves every draft and waits for the writes.
    prepare: async (minIdleMs): Promise<PrepareResult> => {
      const prepare = w[NATIVE_PREPARE_RELOAD];
      if (typeof prepare !== "function") return { ready: false, reason: "saving" };
      return (await prepare(minIdleMs)) as PrepareResult;
    },
    flush: async () => {
      const flush = w[NATIVE_FLUSH];
      if (typeof flush === "function") await flush();
    },
    hold: () => currentUpdateHold(),
    activity: userActivity,
    controlled: () => !!navigator.serviceWorker?.controller,
  });

  // A sync in progress: wait for it (a reload would cut a pull or push short).
  const releaseSync = addUpdateHold(() =>
    syncController.getState().status === "syncing" || togetherRunner.getState().running ? "syncing" : null,
  );

  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => updater.needRefresh(),
    onNeedReload: () => updater.needReload(),
    onRegisteredSW: (_url, r) => {
      registration = r;
      // On start: register() alone does not look again for an already registered worker.
      updater.checkNow();
    },
  });

  setAppUpdater(updater);
  return () => {
    releaseSync();
    stopTracking();
    updater.dispose();
    setAppUpdater(null);
  };
}
