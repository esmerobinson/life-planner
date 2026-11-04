// Esme's Farm: one live view of the farm for the whole app (the nook, the earned moments and the
// farm page all read it). Earned stickers are computed here from her data; only the farm's own
// facts are read from the farm table.

import Dexie, { liveQuery } from "dexie";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { db } from "../data/db";
import type { Goal, ISODate, Item } from "../domain/types";
import { loadJournalKey } from "../journal/keyStore";
import { touchesJournal } from "../ui/useGoalSources";
import { counters, allEarned, derivedEarned, type Counters, type JournalFacts } from "./earning";
import * as repo from "./farmRepo";
import { readJournalFacts } from "./journalFacts";
import { EMPTY_FARM, farmState, type CharacterId, type FarmState } from "./state";
import { arrivedAt, awakeZones, momentQueue, todayListFinished, unlockedAccessories } from "./world";

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

/** The journal's facts while it opens here (null while locked; never blocks the farm). */
function useJournalFacts(): JournalFacts | null {
  const [facts, setFacts] = useState<JournalFacts | null>(null);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const id = ++latest.current;
    let next: JournalFacts | null = null;
    try {
      const jk = await loadJournalKey(db);
      if (jk) next = await readJournalFacts(jk);
    } catch {
      next = null;
    }
    if (id === latest.current) setFacts(next);
  }, []);
  useEffect(() => {
    void load();
    const onMutated = (parts: Record<string, unknown> | undefined) => {
      const keys = Object.keys(parts ?? {});
      if (keys.length === 0 || keys.some(touchesJournal)) void load();
    };
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => {
      latest.current++;
      Dexie.on.storagemutated.unsubscribe(onMutated);
    };
  }, [load]);
  return facts;
}

export function FarmProvider({ items, goals, today, children }: { items: Item[]; goals: Goal[]; today: ISODate; children: ReactNode }) {
  const [rows, setRows] = useState<unknown[] | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => db.farm.toArray()).subscribe({ next: setRows, error: () => setRows([]) });
    return () => sub.unsubscribe();
  }, []);
  const state = useMemo(() => (rows ? farmState(rows) : EMPTY_FARM), [rows]);
  const journal = useJournalFacts();
  const location = useLocation();
  const onJournal = location.pathname === "/journal" || location.pathname.startsWith("/journal/");

  const c = useMemo(
    () => (state.start ? counters({ start: state.start, today, items, goals, todayDone: state.todayDone, journal }) : null),
    [state.start, state.todayDone, today, items, goals, journal],
  );
  const derived = useMemo(() => (c ? derivedEarned(c) : []), [c]);
  const earned = useMemo(() => (state.start ? allEarned(c, state.seen, state.placed) : []), [c, state]);
  const earnedSet = useMemo(() => new Set(earned), [earned]);
  const arrived = useMemo(() => new Set(arrivedAt(earned.length)), [earned.length]);
  const awake = useMemo(() => awakeZones(earned), [earned]);
  const unlocked = useMemo(() => unlockedAccessories(earned.length, awake, c), [earned.length, awake, c]);
  const queue = useMemo(() => momentQueue(derived, state.seen, state.placed, onJournal), [derived, state, onJournal]);

  // Today's list finished: not derivable later, so it is noted when seen (once the farm has started).
  const finished = state.start !== null && todayListFinished(items, goals, today);
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
    [rows, today, state, c, earned, earnedSet, arrived, awake, unlocked, queue, journal, farmZones, setFarmZones, glint],
  );
  return <FarmContext.Provider value={view}>{children}</FarmContext.Provider>;
}
