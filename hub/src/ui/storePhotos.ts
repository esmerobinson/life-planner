// Photos chosen, pasted or dropped, on a page or a "What I did" note: the ONE picture pipeline
// (round 3b): each is downscaled to a JPEG in the browser (ui/picture.ts) and stored in the
// synced files table (data/repo.ts addPicture). Its id is then referred to by the page's
// `![](file:<id>)` line or the note's `didPhotos`.

import { addPicture } from "../data/repo";
import type { ISODate } from "../domain/types";
import { downscalePicture, isHeic, PICTURE_HEIC, PICTURE_UNREADABLE } from "./picture";

/** Provisional wording (the page's own, round 3b). */
export const PHOTO_NOT_SAVED = "That picture could not be saved. Try again.";

/** The photos among some files (an iPhone HEIC photo can come with no type). */
export function imageFiles(files: Iterable<File> | ArrayLike<File> | null | undefined): File[] {
  return Array.from(files ?? []).filter((f) => f.type.startsWith("image/") || isHeic(f));
}

/**
 * Stores each photo in order. Returns the ids stored, and a kind line when one could not be read
 * (HEIC: why) or saved; the rest still go in.
 */
export async function storePhotos(files: readonly File[], today: ISODate): Promise<{ ids: string[]; message: string | null }> {
  const ids: string[] = [];
  let message: string | null = null;
  for (const file of files) {
    let picture;
    try {
      picture = await downscalePicture(file);
    } catch {
      message ??= isHeic(file) ? PICTURE_HEIC : PICTURE_UNREADABLE;
      continue;
    }
    try {
      ids.push(await addPicture(picture, today));
    } catch {
      message ??= PHOTO_NOT_SAVED;
    }
  }
  return { ids, message };
}
