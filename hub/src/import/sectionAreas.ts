import type { AreaId } from "../domain/types";

const TABLE: Record<string, AreaId> = {
  writing: "writing",
  content: "content",
  art: "art",
  "inner work": "mind",
  "creative technologist": "tech",
  health: "body",
  vibecoding: "tech",
  "production & freelance": "production",
  "life admin": "admin",
  leisure: "mind",
};

function normalise(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u200D\uFE0E\uFE0F]/g, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Maps a Backlog `## ` heading to an area. Anything unrecognised stays in the inbox. */
export function sectionToArea(heading: string): AreaId {
  const key = normalise(heading);
  return Object.prototype.hasOwnProperty.call(TABLE, key) ? TABLE[key] : "inbox";
}
