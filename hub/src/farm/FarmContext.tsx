// Esme's Farm: one live view of the farm for the whole app (the nook, the earned moments and the
// farm page all read it). Earned stickers are computed here from her data; only the farm's own
// facts are read from the farm table.

import Dexie, { liveQuery } from "dexie";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ErrorGuard } from "../ui/ErrorGuard";
import { db } from "../data/db";
import type { Goal, ISODate, Item } from "../domain/types";
import { loadJournalKey } from "../journal/keyStore";
import { counters, allEarned, derivedEarned, type Counters, type JournalFacts } from "./earning";
import * as repo from "./farmRepo";
import { readJournalFacts } from "./journalFacts";
import { EMPTY_FARM, farmState, type CharacterId, type FarmState } from "./state";
import { arrivedAt, awakeZones, farmDay, momentQueue, stickerTotals, todayListFinished, unlockedAccessories } from "./world";

export interface FarmView {
  /** The farm table has been read. */
  loaded: boolean;
  today: ISODate;
  state: FarmState;
  /** Null before the farm's first open. */
  counters: Counters | null;
  /** Everything earned (book order): what the data earns, plus anything seen or placed. */
  earned: readonly string[];
  earnedSet: ReadonlySet<string>;
  /** Collection stickers earned (of 175; bonus stickers and ×N counts never count): the book's total and the crown. */
  collected: number;
  arrived: ReadonlySet<CharacterId>;
  awake: ReadonlySet<string>;
  /** Accessory codes unlocked. */
  unlocked: readonly string[];
  /** Earned moments still to play, one at a time. */
  queue: readonly string[];
  /** The journal opens on this device (journal stickers can be counted). */
  journalOpen: boolean;
  /** The farm page's open book spread's zones (the farm's nook host follows them). */
  farmZones: readonly string[];
  setFarmZones: (zones: readonly string[]) => void;
  /** A sticker went into the book since she last opened it (the book icon glints). */
  glint: boolean;
  clearGlint: () => void;
  ensureStart: () => Promise<void>;
  markSeen: (sticker: string) => Promise<void>;
  place: (sticker: string) => Promise<void>;
  markArrived: (c: CharacterId) => Promise<void>;
  setOutfit: (c: CharacterId, item: string | null) => Promise<void>;
}

const FarmContext = createContext<FarmView | null>(null);

export function useFarm(): FarmView | null {
  return useContext(FarmContext);
}

/**
 * After a journal change, the farm re-reads the journal once things settle (a technical
 * debounce, not a motion timing). Re-reading opens only new or changed rows (journalFacts.ts).
 */
const JOURNAL_RELOAD_MS = 2000;

/** A changed-part key (`idb://<db>/<table>/…`) naming the journal table itself. */
export const touchesJournalTable = (part: string): boolean => /^idb:\/\/[^/]+\/journal(\/|$)/.test(part);
const touchesSyncMeta = (part: string): boolean => /^idb:\/\/[^/]+\/syncMeta(\/|$)/.test(part);

/**
 * The journal's facts while it opens here (null while locked; never blocks the farm). Only read
 * once the farm has started (`on`). Re-read when the journal table changes, or when the
 * confirmed key itself changes; a sync's bookkeeping (syncMeta cursor writes) is not a reason
 * (review I2).
 */
function useJournalFacts(on: boolean): JournalFacts | null {
  const [facts, setFacts] = useState<JournalFacts | null>(null);
  const latest = useRef(0);
  const keyFp = useRef<string | null>(null);
  const load = useCallback(async () => {
    const id = ++latest.current;
    let next: JournalFacts | null = null;
    try {
      const jk = await loadJournalKey(db);
      keyFp.current = jk?.fp ?? null;
      if (jk) next = await readJournalFacts(jk);
    } catch {
      next = null;
    }
    if (id === latest.current) setFacts(next);
  }, []);
  useEffect(() => {
    if (!on) return;
    void load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), JOURNAL_RELOAD_MS);
    };
    const onMutated = (parts: Record<string, unknown> | undefined) => {
      const keys = Object.keys(parts ?? {});
      if (keys.length === 0 || keys.some(touchesJournalTable)) return later();
      if (keys.some(touchesSyncMeta)) {
        // Only a different confirmed key matters here (unlocked, re-paired or forgotten).
        void loadJournalKey(db).then(
          (jk) => {
            if ((jk?.fp ?? null) !== keyFp.current) later();
          },
          () => undefined,
        );
      }
    };
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => {
      latest.current++;
      clearTimeout(timer);
      Dexie.on.storagemutated.unsubscribe(onMutated);
    };
  }, [load, on]);
  return on ? facts : null;
}

/**
 * Every item that isn't in the Bin, archived ones included: archiving never takes anything away
 * from the farm (review I3). The shell's lists leave archived items out, so the farm reads its own.
 * Only once the farm has started (`on`): before that nothing is counted, and a full read after
 * every write would slow every page (a thousand quick writes, a thousand full reads).
 */
export function useFarmItems(on: boolean): Item[] {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    if (!on) return;
    const sub = liveQuery(() => db.items.filter((i) => i.status !== "deleted" && i.status !== "purged").toArray()).subscribe({
      next: setItems,
      error: () => undefined,
    });
    return () => sub.unsubscribe();
  }, [on]);
  return on ? items : NO_ITEMS;
}
const NO_ITEMS: Item[] = [];

/**
 * The farm's view for everything inside it. The farm is worked out in its own component under
 * an error guard (bug #46): if anything in the farm throws, the farm switches off (no nook, no
 * stickers this session) and the rest of the app, the Journal above all, stays on screen.
 */
export function FarmProvider({ items, goals, today, children }: { items: Item[]; goals: Goal[]; today: ISODate; children: ReactNode }) {
  const [view, setView] = useState<FarmView | null>(null);
  const [failed, setFailed] = useState(false);
  return (
    <FarmContext.Provider value={failed ? null : view}>
      {!failed && (
        <ErrorGuard name="farm" onError={() => setFailed(true)}>
          <FarmEngine items={items} goals={goals} today={today} onView={setView} />
        </ErrorGuard>
      )}
      {children}
    </FarmContext.Provider>
  );
}

function FarmEngine({ items: listItems, goals, today, onView }: { items: Item[]; goals: Goal[]; today: ISODate; onView: (v: FarmView) => void }) {
  const [rows, setRows] = useState<unknown[] | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => db.farm.toArray()).subscribe({ next: setRows, error: () => setRows([]) });
    return () => sub.unsubscribe();
  }, []);
  const state = useMemo(() => (rows ? farmState(rows) : EMPTY_FARM), [rows]);
  const items = useFarmItems(state.start !== null);
  const journal = useJournalFacts(state.start !== null);
  const location = useLocation();
  const onJournal = location.pathname === "/journal" || location.pathname.startsWith("/journal/");

  const c = useMemo(
    () => (state.start ? counters({ start: state.start, today, items, goals, todayDone: state.todayDone, journal }) : null),
    [state.start, state.todayDone, today, items, goals, journal],
  );
  const derived = useMemo(() => (c ? derivedEarned(c) : []), [c]);
  const earned = useMemo(() => (state.start ? allEarned(c, state.seen, state.placed) : []), [c, state]);
  const earnedSet = useMemo(() => new Set(earned), [earned]);
  // Of the 175 (the book's total, the crown), and for friends and hats: plus each bonus sticker once.
  const { collected, friends } = useMemo(() => stickerTotals(earnedSet), [earnedSet]);
  // Friends arrive at N stickers or on day N of the farm, whichever comes first (Esme, 2026-11-04).
  // Once moved in, a character stays (review M5), even if fewer stickers show on this device.
  const day = state.start ? farmDay(state.start, today) : 1;
  const arrived = useMemo(() => new Set([...arrivedAt(friends, day), ...state.arrived]), [friends, day, state.arrived]);
  const awake = useMemo(() => awakeZones(earned), [earned]);
  const unlocked = useMemo(() => unlockedAccessories(friends, awake, earnedSet), [friends, awake, earnedSet]);
  const queue = useMemo(() => momentQueue(derived, state.seen, state.placed, onJournal), [derived, state, onJournal]);

  // Today's list finished: not derivable later, so it is noted when seen (once the farm has started).
  const started = state.start !== null;
  const finished = useMemo(() => started && todayListFinished(listItems, goals, today), [started, listItems, goals, today]);
  const noted = state.todayDone.includes(today);
  useEffect(() => {
    if (finished && !noted) void repo.recordTodayDone(today).catch(() => undefined);
  }, [finished, noted, today]);

  const [farmZones, setZones] = useState<readonly string[]>([]);
  const setFarmZones = useCallback((z: readonly string[]) => setZones((prev) => (prev.join() === z.join() ? prev : z)), []);
  const [glint, setGlint] = useState(false);

  const view = useMemo<FarmView>(
    () => ({
      loaded: rows !== null,
      today,
      state,
      counters: c,
      earned,
      earnedSet,
      collected,
      arrived,
      awake,
      unlocked,
      queue,
      journalOpen: journal !== null,
      farmZones,
      setFarmZones,
      glint,
      clearGlint: () => setGlint(false),
      ensureStart: () => repo.ensureStart(today),
      markSeen: async (k) => {
        await repo.markSeen(k, today);
        setGlint(true);
      },
      place: (k) => repo.placeSticker(k, today),
      markArrived: (ch) => repo.markArrived(ch, today),
      setOutfit: repo.setOutfit,
    }),
    [rows, today, state, c, earned, earnedSet, collected, arrived, awake, unlocked, queue, journal, farmZones, setFarmZones, glint],
  );
  useEffect(() => onView(view), [view, onView]);
  return null;

}
