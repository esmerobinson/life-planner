/** The one list of area ids. Nothing else may hard-code it; derive from this. */
export const AREA_IDS = [
  "inbox", "writing", "art", "content", "mind", "body", "tech", "production", "admin",
] as const;
export type AreaId = (typeof AREA_IDS)[number];
export type Priority = 1 | 2 | 3;
/** The one lists of weekdays and item sources. Validators derive from these. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const SOURCE_KINDS = ["backlog", "manual", "gtasks", "obsidian"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type ISODate = string;

export interface Item {
  id: string;
  kind: "task" | "idea";
  title: string;
  notes?: string;
  links: string[];
  tags?: string[];
  areaId: AreaId;
  goalId?: string;
  priority: Priority;
  due?: ISODate;
  recur?: Weekday[];
  /**
   * "deleted": in the Bin (restorable). "purged": emptied from the Bin for good; the row
   * stays as a content-free tombstone because sync never hard-deletes.
   */
  status: "open" | "done" | "archived" | "deleted" | "purged";
  /** When it went into the Bin (status "deleted"). */
  deletedAt?: ISODate;
  pinnedDate?: ISODate;
  weekOf?: ISODate;
  hiddenOn?: ISODate;
  completedAt?: ISODate;
  /** A goal's big step (round 3): counted for the goal's overall progress. */
  milestone?: boolean;
  /** Position among its goal's steps (a goal's "To come" sorts undated steps by it). */
  order?: number;
  /** Habits: the days it was ticked (sorted, the most recent 400 kept). Never changes `status`. */
  doneDates?: ISODate[];
  createdAt: ISODate;
  touchedAt: ISODate;
  source?: { kind: SourceKind; key: string };
  /**
   * Sync stamp: epoch ms of the latest write, set on EVERY write by the change tracker
   * (data/changeTracking.ts). Optional only so older backups still load.
   */
  updatedAt?: number;
}

/**
 * Legacy (before round 3): a goal's own checklist. Milestones are now flagged tasks
 * (`Item.milestone`); data/migrateMilestones.ts turns these into them and leaves the
 * goal's list empty. The field stays (always []) so older app versions still accept goals.
 */
export interface Milestone {
  id: string;
  title: string;
  done: boolean;
}

export interface Goal {
  id: string;
  title: string;
  areaId: AreaId;
  kind: "finite" | "practice";
  deadline?: ISODate;
  monthlyTarget?: number;
  milestones: Milestone[];
  /** Why this goal matters, in the user's words. Plain text. */
  why?: string;
  /** How often it is worked on, e.g. "Weekly: 3 sessions". Plain text. */
  cadence?: string;
  notes?: string;
  source?: { kind: "obsidian"; key: string };
  createdAt: ISODate;
  /**
   * Absent for a live goal. "deleted": in the Bin (restorable); "purged": emptied from the
   * Bin, kept as a content-free tombstone because sync never hard-deletes.
   */
  status?: "deleted" | "purged";
  /** When it went into the Bin (status "deleted"). */
  deletedAt?: ISODate;
  /** Sync stamp, as on Item. */
  updatedAt?: number;
}

/**
 * A picture on a task's / idea's / goal's page (round 3b). The page's Markdown refers to it
 * as `![](file:<id>)`. Synced like items and goals; `data` is the image itself as base64
 * (no `data:` prefix), downscaled in the browser so a row stays well under the sync
 * server's 1 MB row cap.
 */
export interface FileRow {
  id: string;
  mime: string;
  /** Base64 of the image bytes; "" once purged. */
  data: string;
  width: number;
  height: number;
  createdAt: ISODate;
  /**
   * "purged": the page it was on was emptied from the Bin; the row stays as a content-free
   * tombstone (no data) because sync never hard-deletes.
   */
  status?: "purged";
  /**
   * A journal photo (journal round): `data` is the AES-GCM ciphertext (base64) of the JPEG,
   * sealed with the journal key and `iv`. Only the Journal page shows these.
   */
  encrypted?: true;
  /** Base64 of the 12-byte AES-GCM IV, on encrypted rows only. */
  iv?: string;
  /** Fingerprint of the key that sealed it (journal/crypto.ts), on encrypted rows. */
  fp?: string;
  /** Sync stamp, as on Item. */
  updatedAt?: number;
}

/**
 * The kinds of journal row (journal round, fix round 1). Every part of a day is its own row,
 * so two devices never overwrite each other's part (rows only ever replace themselves):
 * - "page"     `page:<date>:<uuid>`        one finished morning page ("I'm done")
 * - "photo"    `photo:<date>:<fileId>`     one morning photo (the sealed image is the file row)
 * - "draft"    `draft:<date>:<deviceId>`   the page being written on one device (emptied when done)
 * - "answer"   `answer:<date>:<promptId>`  one check-in answer
 * - "set"      `set:<date>`                the day's questions (written by the first device to open it)
 * - "settings" `settings`                  Choose questions (synced)
 * - "verifier" `verifier`                  a known value sealed with the first confirmed key
 * - "cards"    `cards`                     the imported exercise cards, the whole set (exercise brief)
 * - "exercise" `exercise:<date>:<deviceId>` one device's exercise card for a day, and whether it was ticked
 * - "stars"    `stars:<deviceId>`          one device's exercise card stars (newest mark per card wins)
 * - "exercise-entry" `exercise-entry:<date>:<cardKey>:<deviceId>` one device's written response to
 *                                          a day's card (journal polish brief; cardKey is an opaque HMAC)
 * - "morning" / "checkin" `${kind}:<date>` the earlier one-row-per-day shape: read (split), never written
 */
export const JOURNAL_KINDS = [
  "page", "photo", "draft", "answer", "set", "settings", "verifier", "morning", "checkin", "cards", "exercise", "stars",
  "exercise-entry",
] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/**
 * One journal row (journal round), end-to-end encrypted. Only `kind`, `date`, the id and
 * the key fingerprint are in clear; everything typed is inside `ct`, sealed with the
 * journal key (journal/crypto.ts). Rows merge by last-write-wins like every row.
 */
export interface JournalRow {
  id: string;
  kind: JournalKind;
  date: ISODate;
  /** Fingerprint of the key that sealed it (absent only on the earlier shape). */
  fp?: string;
  /** Base64 of the 12-byte AES-GCM IV. */
  iv: string;
  /** Base64 of the AES-GCM ciphertext (with its tag) of the entry's JSON. */
  ct: string;
  /** Sync stamp, as on Item. */
  updatedAt?: number;
}
