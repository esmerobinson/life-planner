import Dexie from "dexie";
import { useContext, useEffect, useState } from "react";
import { getFile } from "../data/repo";
import type { FileRow } from "../domain/types";
import { ShellContext } from "./shellContext";

/** A file row, re-read when anything is written (sync brings it later on another device). */
export function useFile(id: string): FileRow | null | undefined {
  const version = useContext(ShellContext)?.version ?? 0;
  const [file, setFile] = useState<FileRow | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () =>
      getFile(id).then(
        (f) => {
          if (!live) return;
          setFile((had) => (had && f && had.updatedAt === f.updatedAt && had.status === f.status ? had : (f ?? null)));
        },
        () => live && setFile(null),
      );
    void load();
    const onMutated = () => void load();
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => {
      live = false;
      Dexie.on.storagemutated.unsubscribe(onMutated);
    };
  }, [id, version]);
  return file;
}
