import { useCallback, useState } from "react";

/** Shown once per page when a read from the local database fails. */
export const DATA_ERROR = "Your data could not be read. Reload to try again.";

/** Shown beside an action whose write failed. */
export const SAVE_ERROR = "That did not save. Try again.";

/**
 * Runs a write and turns a failure into the plain save message instead of an
 * unhandled rejection. The message stays until the next attempt starts (no timer,
 * so no invented duration). Returns true when the write succeeded.
 */
export function useSaveError() {
  const [failed, setFailed] = useState(false);
  const attempt = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    setFailed(false);
    try {
      await fn();
      return true;
    } catch {
      setFailed(true);
      return false;
    }
  }, []);
  return { attempt, saveError: failed ? SAVE_ERROR : null };
}
