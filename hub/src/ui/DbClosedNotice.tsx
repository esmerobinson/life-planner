import { useEffect, useState } from "react";
import type Dexie from "dexie";

/**
 * When another tab running a NEWER build upgrades the database, this tab's connection is
 * closed (so the upgrade can go ahead) and its writes would fail. Say so plainly instead
 * of failing silently. Placeholder presentation: the same markup as the update prompt.
 */
export function DbClosedNotice({ db }: { db: Dexie }) {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const onVersionChange = () => {
      setClosed(true);
      // Returning nothing lets Dexie close this connection, so the other tab can upgrade.
    };
    db.on("versionchange", onVersionChange);
    return () => db.on("versionchange").unsubscribe(onVersionChange);
  }, [db]);
  if (!closed) return null;
  return (
    <p role="alert" className="update-prompt">
      Esmeworld was updated. Reload to keep going.{" "}
      <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </p>
  );
}
