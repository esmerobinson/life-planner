/** The one list of area ids. Nothing else may hard-code it; derive from this. */
export const AREA_IDS = [
  "inbox", "mind", "writing", "art", "content", "body", "tech", "production", "admin",
] as const;
export type AreaId = (typeof AREA_IDS)[number];
export type Priority = 1 | 2 | 3;
/** The one lists of weekdays and item sources. Validators derive from these. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const SOURCE_KINDS = ["backlog", "manual", "gtasks", "obsidian"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type ISODate = string;
/** A book's place on the reading list: Want to read, Reading, Read. */
export const BOOK_STATUSES = ["want", "reading", "read"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

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
  /**
   * A to-do's time on its day ("HH:MM", 24-hour), for meetings and appointments (Due
   * reminders, 2026-11-16). Means something only with a day: `pinnedDate` ("Do it on"), else
   * `due`. The Due reminder goes off its lead before. An older app version keeps it as it is
   * (its validator ignores fields it doesn't know, and it updates rows field by field).
   */
  time?: string;
  weekOf?: ISODate;
  hiddenOn?: ISODate;
  completedAt?: ISODate;
  /** A goal's big step (round 3): counted for the goal's overall progress. */
  milestone?: boolean;
  /** Position among its goal's steps (a goal's "To come" sorts undated steps by it). */
  order?: number;
  /** Habits: the days it was ticked (sorted, the most recent 400 kept). Never changes `status`. */
  doneDates?: ISODate[];
  /**
   * A project to-do (projects round): 1–20 sessions, done when every session is (domain/
   * projects.ts). Only on `kind: "task"`, never with `recur`. Its deadline is `due`.
   */
  sessions?: Session[];
  /**
   * Reading list (2026-11-04): an idea with a `bookStatus` is a book (domain/books.ts). Books
   * live under Mind. Every book field is optional; an older app version keeps them as they are
   * (it spreads rows when it writes them) and its validator ignores them.
   */
  bookStatus?: BookStatus;
  /** The book's author, at most 200 characters. */
  author?: string;
  /** How many pages the book has (1–100,000). */
  pages?: number;
  /** The page reached (0–100,000; never past `pages`). */
  pageAt?: number;
  /** The day it was marked Read. */
  finishedOn?: ISODate;
  /** One http(s) address for the book (a library or shop page), at most 2000 characters. */
  link?: string;
  /**
   * Fields put away by Change to, so nothing is lost and changing back restores them
   * (fix round 1, I-3/I-5): a to-do's due date, repeat, day pin, hide, milestone flag and done
   * date while it is a book; a book's status, author, pages, page, finished date and link while
   * it is a to-do or an idea. Never shown. An older app version keeps it as it is.
   */
  stash?: ItemStash;
  /**
   * "What I did" (Esme, 19 Nov 2026): what she actually did when she ticked the to-do off, and
   * the files she kept with it. A plain to-do has at most one entry; a project one per session
   * ticked (`session`). Only names and folder paths of files, never their contents. Synced like
   * any to-do field (not end-to-end encrypted). An older app version keeps it as it is (its
   * validator ignores fields it doesn't know, and it spreads rows when it writes them).
   */
  did?: DidEntry[];
  /**
   * Photos on "What I did" notes (Esme, 19 Nov 2026), by note id: pictures in the synced files
   * table, like a page's. Kept here, not inside a note, because an older app version refuses a
   * note with a key it doesn't know (domain/whatIDid.ts validDid) but keeps an unknown item
   * field as it is. A note left with only photos stays as `{ id, on }` in `did`.
   */
  didPhotos?: DidPhotos[];
  /**
   * Photos taken off this to-do's notes (review M2, 20 Nov 2026): kept in the row so a device that
   * syncs later merges its own new photos in without bringing back one removed elsewhere. Newest
   * last, at most MAX_DID_GONE. An older app version keeps it as it is.
   */
  didPhotosGone?: string[];
  createdAt: ISODate;
  touchedAt: ISODate;
  source?: { kind: SourceKind; key: string };
  /**
   * Sync stamp: epoch ms of the latest write, set on EVERY write by the change tracker
   * (data/changeTracking.ts). Optional only so older backups still load.
   */
  updatedAt?: number;
}

/** One "What I did" note on a to-do (domain/whatIDid.ts). */
export interface DidEntry {
  id: string;
  /** The day it was done (the tick's day). */
  on: ISODate;
  /** What she did, in her words. Absent when nothing is typed. */
  note?: string;
  /** Files copied into her folders on the Mac (names and where; never the contents). */
  files?: DidFile[];
  /** A project's session this note is for (its id). */
  session?: string;
}

/** The photos on one "What I did" note: the note's id and its pictures' file ids, in order. */
export interface DidPhotos {
  entry: string;
  ids: string[];
}

/** One file kept with a "What I did" note: its saved name and the folder it was copied into. */
export interface DidFile {
  /** The file's name as saved (after " (2)" etc.). */
  name: string;
  /** The folder it was saved in, "~/Desktop/Writing/Book" style ("~" is her home folder). */
  folder: string;
}

/** The to-do-only fields a book keeps put away. */
export type TaskStash = Partial<Pick<Item, "due" | "recur" | "pinnedDate" | "hiddenOn" | "milestone" | "completedAt">>;
/** The book fields a to-do or idea keeps put away. */
export type BookStash = Partial<Pick<Item, "bookStatus" | "author" | "pages" | "pageAt" | "finishedOn" | "link">>;
export interface ItemStash {
  task?: TaskStash;
  book?: BookStash;
}

/** One session of a project to-do. Unnamed sessions are called "Session 3" by their place. */
export interface Session {
  id: string;
  /** At most 120 characters; absent when unnamed. */
  title?: string;
  /** What the session is, in her words. At most 1000 characters. */
  details?: string;
  /** The day it was ticked. */
  doneOn?: ISODate;
  /** The day it is planned for (it then shows on Today that day). */
  plannedFor?: ISODate;
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

/**
 * Where a goal's automatic count comes from (goals redesign):
 * - "journal": a day with a morning page or photo, or a check-in answer;
 * - "exercise": a mental health exercise card marked done (or a tracker day logged);
 * - "linked": a to-do linked to the goal ticked done, or a linked habit's session;
 * - { area }: any to-do in that area ticked done, or that area's habit sessions.
 */
export const COUNT_SOURCE_KINDS = ["journal", "exercise", "linked"] as const;
export type CountSource = (typeof COUNT_SOURCE_KINDS)[number] | { area: AreaId };

/**
 * One of a goal's monthly goals (goals redesign): a count ("Writing sessions 12 / 20") or a
 * step (ticked). A count is automatic when its goal counts itself (`countsFrom`); otherwise
 * each +1 adds that day to `log`.
 */
export interface MonthGoal {
  id: string;
  /** "YYYY-MM". */
  month: string;
  kind: "count" | "step";
  title: string;
  /** Counts: the number to reach. */
  target?: number;
  /** Steps: ticked. */
  done?: boolean;
  /** Manual counts: one date per +1. */
  log?: ISODate[];
  /** Counts: false keeps it manual even when the goal counts itself. */
  auto?: boolean;
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
  /** Chosen to show in the Home goals column ("Show on Home"). Absent means not chosen. */
  onHome?: boolean;
  /**
   * Goals redesign: false = inactive (hidden from Home, area pages, pickers and counting;
   * shown on the Goals page under Inactive). Absent means active.
   */
  active?: boolean;
  /** "daily": a goal done every day (its count is days, it has a streak). Absent: not daily. */
  rhythm?: "daily";
  /** Sources that count for the goal by themselves (goals redesign). */
  countsFrom?: CountSource[];
  /** The goal's monthly goals ("November goals"), every month's, oldest first. */
  monthGoals?: MonthGoal[];
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
 * - "note"     `note:<date>:<uuid>`        one note to herself (journal v3), rewritten whole on edit
 * - "highlight" `highlight:<date>:<hid>_<deviceId>_<vid>` one version of one highlight in a card's
 *                                          learning text (Highlights; data/highlightRepo.ts)
 * - "note-read" `note-read:<date>:<deviceId>` one device's "I read this today" ticks for a day
 * - "keywrap"  `keywrap:<kekFp>`           the journal secret sealed with one sync passphrase's
 *                                          key-wrap key (journal re-key; journal/keyStore.ts)
 * - "share"    `share:<date>:<part>`       one "Keep my answers private" tick for a day (Together link;
 *                                          part "exercise" or "checkin", each its own row)
 * - "learned"  `learned:<date>:<deviceId>` one device's "what I learned today" words (Mental health exercise)
 * - "day-log"  `day-log:<date>:<deviceId>_<vid>` one version of a day's daily log (schedule / to-dos;
 *                                          journal/routine.ts, data/routineRepo.ts)
 * - "week-review" `week-review:<date>:<deviceId>_<vid>` one version of a week's Sunday review
 *
 * An app version that doesn't know a kind refuses the row (validJournal), so sync keeps it in
 * quarantine until an update can read it: never stored, never fatal.
 */
export const JOURNAL_KINDS = [
  "page", "photo", "draft", "answer", "set", "settings", "verifier", "morning", "checkin", "cards", "exercise", "stars",
  "exercise-entry", "note", "note-read", "keywrap", "share", "learned",
  "highlight", "day-log", "week-review",
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
