import { useSyncExternalStore } from "react";
import { getAppUpdater, type AutoUpdater, type UpdateState } from "../native/pwaUpdate";

/** The part of the updater (native/pwaUpdate.ts) this component needs (tests pass a fake). */
export type PromptUpdater = Pick<AutoUpdater, "getState" | "subscribe" | "reloadNow">;

const NONE: UpdateState = { waiting: false, showNote: false };
const noSubscribe = () => () => {};

/**
 * "A new version is ready · Reload": the fallback when the automatic update (native/pwaUpdate.ts)
 * keeps being refused. Reload saves everything, then switches to the new version.
 */
export function UpdatePrompt({ updater = getAppUpdater() }: { updater?: PromptUpdater | null }) {
  const { showNote } = useSyncExternalStore(updater?.subscribe ?? noSubscribe, updater?.getState ?? (() => NONE));
  if (!updater || !showNote) return null;
  return (
    <p role="status" className="update-prompt">
      A new version is ready.{" "}
      <button type="button" className="btn-secondary" onClick={() => void updater.reloadNow()}>
        Reload
      </button>
    </p>
  );
}
