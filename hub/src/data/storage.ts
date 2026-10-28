export type PersistenceStatus = "persisted" | "not-persisted" | "unsupported";

/** Asks the browser to keep this site's data. Never throws. */
export async function requestPersistence(): Promise<PersistenceStatus> {
  try {
    const persist = navigator.storage?.persist;
    if (typeof persist !== "function") return "unsupported";
    return (await navigator.storage.persist()) ? "persisted" : "not-persisted";
  } catch {
    return "unsupported";
  }
}
