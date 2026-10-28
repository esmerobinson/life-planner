import { useSyncExternalStore } from "react";
import { db } from "../data/db";
import { SyncController, type SyncState } from "./controller";

/** The app's one sync controller (on the app database, using the browser's fetch). */
export const syncController = new SyncController({ db, fetch: (input, init) => fetch(input, init) });

/** The current sync state, for the UI. */
export function useSyncState(controller: SyncController = syncController): SyncState {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
