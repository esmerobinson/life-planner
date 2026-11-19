import { registerSW } from "virtual:pwa-register";
import { NATIVE_FLUSH, NATIVE_PREPARE_RELOAD, type PrepareResult } from "./appUpdate";
import { createAutoUpdater, setAppUpdater } from "./pwaUpdate";
import { addUpdateHold, currentUpdateHold } from "./updateHolds";
import { syncController } from "../sync";
import { togetherRunner } from "../together/runner";

/** The Mac app serves the web app from esmeworld://app/ (mac/Esmeworld/main.swift). */
const MAC_APP_PROTOCOL = "esmeworld:";

/**
 * Registers the service worker and starts the automatic updates (pwaUpdate.ts), from main.tsx.
 * Returns a function that stops them (tests).
 */
export function startPwaUpdates(where: { protocol: string } = window.location): () => void {
  const w = window as unknown as Record<string, unknown>;
  let registration: ServiceWorkerRegistration | undefined;
  let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined;

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
    updater.dispose();
    setAppUpdater(null);
  };
}
