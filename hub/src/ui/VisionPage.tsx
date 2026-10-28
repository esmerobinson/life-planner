import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { db } from "../data/db";
import {
  describeAge,
  fetchBoard,
  isStale,
  parseBoardInput,
  readBoardSetting,
  readCachedBoard,
  saveBoardSetting,
  syncConfigured,
  type CachedBoard,
  type FetchOutcome,
} from "../vision/board";

/** Re-reads "updated N min ago" once a minute (a clock, not motion). */
const AGE_TICK_MS = 60_000;

type Problem = Exclude<FetchOutcome["kind"], "ok">;

function ProblemLine({ problem }: { problem: Problem }) {
  switch (problem) {
    case "not-configured":
      return (
        <p className="vision-note">
          Set up Sync on this device to show your Pinterest board here. <Link to="/sync">Sync</Link>
        </p>
      );
    case "needs-passphrase":
      return (
        <p className="vision-note">
          The sync passphrase was not accepted. Enter it again to refresh the board. <Link to="/sync">Sync</Link>
        </p>
      );
    case "rate-limited":
      return <p className="vision-note">The sync server asked to wait a little. Try Refresh again in a few minutes.</p>;
    case "unavailable":
      return <p className="vision-note">Pinterest did not answer just now. Try Refresh in a little while.</p>;
    case "offline":
      return <p className="vision-note">Could not reach the sync server. Try Refresh when you are back online.</p>;
    default:
      return <p className="vision-note">Loading the board did not work this time. Try Refresh in a little while.</p>;
  }
}

/**
 * The Vision board: Esme's public Pinterest board as a borderless collage of just the
 * photos (VISUAL-LANGUAGE.md "Vision board"; mockup-vision.html tab D). Tapping a photo
 * opens the pin on Pinterest.
 */
export function VisionPage({
  fetchFn = (input, init) => fetch(input, init),
  now = Date.now,
}: {
  fetchFn?: typeof fetch;
  now?: () => number;
}) {
  const [board, setBoard] = useState<string | null>(null);
  const [shown, setShown] = useState<CachedBoard | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [clock, setClock] = useState(now);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<"short-link" | "invalid" | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  /** The board the page is showing now; answers for any other board are dropped. */
  const current = useRef<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(
    async (which: string) => {
      setLoading(true);
      const out = await fetchBoard({ db, fetch: fetchFn }, which);
      if (!alive.current || current.current !== which) return;
      setLoading(false);
      setClock(now());
      if (out.kind === "ok") {
        setShown(out.board);
        setProblem(null);
      } else {
        setProblem(out.kind);
        if (out.kind === "not-configured") setConfigured(false);
      }
    },
    [fetchFn, now],
  );

  useEffect(() => {
    alive.current = true;
    let active = true; // this run of the effect (StrictMode runs it twice in development)
    void (async () => {
      let which: string;
      let cached: CachedBoard | null;
      let hasSync: boolean;
      try {
        [which, cached, hasSync] = await Promise.all([readBoardSetting(db), readCachedBoard(db), syncConfigured(db)]);
      } catch {
        if (active) setProblem("failed");
        return;
      }
      if (!active) return;
      current.current = which;
      setBoard(which);
      setDraft(which);
      setConfigured(hasSync);
      const mine = cached && cached.board === which ? cached : null;
      setShown(mine);
      if (!hasSync) setProblem("not-configured");
      else if (!mine || isStale(mine.fetchedAt, now())) void refresh(which);
    })();
    const tick = setInterval(() => setClock(now()), AGE_TICK_MS);
    return () => {
      active = false;
      alive.current = false;
      clearInterval(tick);
    };
    // Runs once per page open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeBoard(e: FormEvent) {
    e.preventDefault();
    const parsed = parseBoardInput(draft);
    if (!parsed.ok) {
      setDraftError(parsed.reason);
      return;
    }
    setDraftError(null);
    setChangeOpen(false);
    try {
      await saveBoardSetting(db, parsed.board);
    } catch {
      /* used for this visit; asked again next time */
    }
    if (!alive.current) return;
    current.current = parsed.board;
    setBoard(parsed.board);
    setDraft(parsed.board);
    if (shown?.board !== parsed.board) setShown(null);
    if (configured) void refresh(parsed.board);
  }

  const slug = board ? board.split("/")[1] : "";
  const pins = shown?.pins ?? [];

  return (
    <section className="vision-page">
      <div className="vision-head">
        <h1>Vision board</h1>
        {shown && (
          <span className="vision-source">
            from Pinterest · {slug} · {pins.length === 1 ? "1 pin" : `${pins.length} pins`} · updated{" "}
            {describeAge(shown.fetchedAt, clock)}
          </span>
        )}
        {configured && board && (
          <button type="button" className="btn-secondary" onClick={() => void refresh(board)} disabled={loading}>
            Refresh
          </button>
        )}
      </div>
      {board && (
        <details
          className="vision-change"
          open={changeOpen}
          onToggle={(e) => setChangeOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>Change board</summary>
          <form className="vision-change-form" onSubmit={(e) => void changeBoard(e)}>
            <label className="form-field">
              <span className="form-label">Board address</span>
              <input
                type="text"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftError(null);
                }}
                aria-describedby="vision-board-hint"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <button type="submit">Use this board</button>
            <p id="vision-board-hint" className="vision-note">
              Paste the board's address from Pinterest (pinterest.com/name/board) or just name/board. Short pin.it
              links can't be read here: open one in a browser first, then copy the full address.
            </p>
            {draftError === "short-link" && (
              <p className="vision-note" role="alert">
                Short pin.it links can't be opened here. Open it in a browser and paste the pinterest.com address
                it goes to.
              </p>
            )}
            {draftError === "invalid" && (
              <p className="vision-note" role="alert">
                That doesn't look like a board address. It should look like pinterest.com/name/board.
              </p>
            )}
          </form>
        </details>
      )}
      {problem && <ProblemLine problem={problem} />}
      {!shown && loading && <p className="vision-note">Loading your board…</p>}
      {shown && pins.length === 0 && <p className="vision-note">This board has no pins yet.</p>}
      {pins.length > 0 && (
        <div className="vision-collage">
          {pins.map((p) => (
            <a key={p.link} href={p.link} target="_blank" rel="noopener noreferrer" aria-label="Open pin on Pinterest">
              <img src={p.img} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
