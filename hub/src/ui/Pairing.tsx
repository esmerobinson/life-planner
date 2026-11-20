import { useEffect, useMemo, useRef, useState } from "react";
import { parsePairing, type PairingPayload } from "../pairing/pairingText";
import { qrModules, qrPath, readFrame } from "../pairing/qr";
import { useUpdateHold } from "../native/updateHolds";

/** Placeholder copy (Esme may reword). */
export const PAIRING_WARNING = "Anyone who scans this can open your Esmeworld. Only show it to your own devices.";
export const CAMERA_DENIED = "Allow the camera in Settings, or paste the code instead.";
export const NO_CAMERA = "The camera didn't start here. Paste the code instead.";
export const NOT_PAIRING = "That isn't an Esmeworld pairing code.";
export const SCANNER_FAILED = "Couldn't start the scanner. Paste the code instead.";
export const CODE_FAILED = "Couldn't make a pairing code for this passphrase.";
export const TOO_LONG = "That passphrase is too long for a pairing code.";
/**
 * Placeholder copy (Esme may reword), 2026-11-17: under a code that sets up sync only (this
 * device has no copy of the journal's secret to put in it).
 */
export const SYNC_ONLY_NOTE =
  "This code sets up sync only. On the other device, your journal will ask for your passphrase once. To bring the journal along now, hide this and type your passphrase below.";

/** How often a camera frame is read while scanning, in ms (a technical rate, not an animation). */
const SCAN_EVERY_MS = 150;

/**
 * The shown code hides itself after this long (coordinator's rule, concern 1; 2 minutes since
 * 2026-11-17, review I2: one tap now shows it, so it never stays up for long).
 */
export const PAIRING_SHOW_MS = 120_000;

/** "Hides in 0:45". */
export function hidesIn(seconds: number): string {
  const s = Math.max(0, seconds);
  return `Hides in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The pairing code for `text` (a pairing text, v1 or v2) as a black-on-white QR code (SVG), the
 * warning, an optional note, a countdown and Hide. The text is only in the drawn modules: never
 * in an attribute, label or text.
 * It hides itself after 2 minutes, and at once when the page or app goes to the background
 * (visibilitychange to hidden, pagehide, or the window losing focus, as the Mac app does).
 * Showing it again needs another tap.
 */
export function PairingCode({ text, note, onHide }: { text: string; note?: string; onHide: () => void }) {
  const code = useMemo(() => {
    // Too long for any QR code (or any other encoder failure): a plain error, never a throw.
    try {
      const m = qrModules(text);
      return { n: m.length, d: qrPath(m) };
    } catch {
      return null;
    }
  }, [text]);
  const hide = useRef(onHide);
  hide.current = onHide;
  const [left, setLeft] = useState(PAIRING_SHOW_MS / 1000);
  // Shown for another device to scan (untouched for up to 2 minutes): no automatic update.
  useUpdateHold(true, "pairing");

  useEffect(() => {
    // Measured against the clock, so a throttled background timer can't stretch the minute.
    const deadline = Date.now() + PAIRING_SHOW_MS;
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      hide.current();
    };
    const tick = () => {
      const ms = deadline - Date.now();
      if (ms <= 0) close();
      else setLeft(Math.ceil(ms / 1000));
    };
    const timer = setInterval(tick, 1000);
    // The deadline itself, set for the exact remaining time (not only checked on ticks).
    const deadlineTimer = setTimeout(close, PAIRING_SHOW_MS);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") close();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", close);
    window.addEventListener("blur", close);
    return () => {
      done = true;
      clearInterval(timer);
      clearTimeout(deadlineTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", close);
      window.removeEventListener("blur", close);
    };
  }, [text]);

  return (
    <div className="pairing-code">
      {code ? (
        <>
          {/* The modules include the 4-module quiet zone; the white square fills it. */}
          <svg
            role="img"
            aria-label="Pairing code"
            className="pairing-qr"
            viewBox={`0 0 ${code.n} ${code.n}`}
            width={240}
            height={240}
            shapeRendering="crispEdges"
          >
            <rect x={0} y={0} width={code.n} height={code.n} fill="#ffffff" />
            <path d={code.d} fill="#000000" />
          </svg>
          <p>{PAIRING_WARNING}</p>
          {note && <p>{note}</p>}
          <p className="journal-muted" aria-live="off">
            {hidesIn(left)}
          </p>
        </>
      ) : (
        <p role="alert">{CODE_FAILED}</p>
      )}
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onHide}>
          Hide
        </button>
      </div>
    </div>
  );
}

/**
 * "Scan pairing code" (the camera) and "Paste pairing code" (a field). What a valid code holds
 * (v1: the passphrase, exactly as if it had been typed; v2: token, journal secret, address)
 * goes to `onCode`; nothing here keeps it.
 * The camera starts only from the button (a user gesture, as iOS needs) and stops as soon as a
 * pairing code is read, on Cancel, and when this leaves the page.
 */
export function ScanPairingCode({ onCode, busy = false }: { onCode: (code: PairingPayload) => unknown; busy?: boolean }) {
  const [scanning, setScanning] = useState(false);
  // getUserMedia is pending: Scan is disabled, and a second tap never asks again.
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  // The camera is on (or starting): no automatic update.
  useUpdateHold(scanning || starting, "camera");
  const [pasted, setPasted] = useState("");
  const [problem, setProblem] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  // The latest callback, so a code read by the camera loop uses the page as it is now.
  const onPass = useRef(onCode);
  onPass.current = onCode;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // A code read while the page was busy: kept (in memory only) and used once busy clears.
  const queued = useRef<PairingPayload | null>(null);

  /** Hands a code on now, or as soon as the page is no longer busy. */
  function deliver(code: PairingPayload) {
    if (busyRef.current) {
      if (queued.current?.v === 2) queued.current.secret?.fill(0); // only the latest is kept
      queued.current = code;
      return;
    }
    void onPass.current(code);
  }

  useEffect(() => {
    if (busy || queued.current === null) return;
    const code = queued.current;
    queued.current = null;
    void onPass.current(code);
  }, [busy]);

  function release() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function stopCamera() {
    release();
    setScanning(false);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (queued.current?.v === 2) queued.current.secret?.fill(0);
      queued.current = null;
      release();
    };
  }, []);

  async function start() {
    if (busy || scanning || startingRef.current) return;
    setProblem("");
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setProblem(NO_CAMERA);
      return;
    }
    startingRef.current = true;
    setStarting(true);
    let s: MediaStream;
    try {
      // Called straight from the tap, before anything else is awaited (iOS needs the gesture).
      s = await media.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch (e) {
      const name = e instanceof Error || e instanceof DOMException ? e.name : "";
      if (mounted.current) setProblem(name === "NotAllowedError" || name === "SecurityError" ? CAMERA_DENIED : NO_CAMERA);
      return;
    } finally {
      startingRef.current = false;
      if (mounted.current) setStarting(false);
    }
    if (!mounted.current) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    // Never two cameras: any stream already here is stopped before the new one is kept.
    if (stream.current && stream.current !== s) stream.current.getTracks().forEach((t) => t.stop());
    stream.current = s;
    setScanning(true);
  }

  // Once the video is on the page: show the camera and read frames until a pairing code.
  useEffect(() => {
    if (!scanning) return;
    const video = videoRef.current;
    const s = stream.current;
    if (!video || !s) return;
    video.srcObject = s;
    try {
      void Promise.resolve(video.play()).catch(() => undefined);
    } catch {
      /* autoplay refused: frames still arrive once it plays */
    }
    const tick = async () => {
      timer.current = null;
      if (stream.current !== s) return;
      let text: string | null = null;
      try {
        text = await readFrame(video); // null: no code in this frame
      } catch {
        // The decoder (a separate chunk) didn't load, or frames can't be read: stop for good.
        if (stream.current !== s) return;
        stopCamera();
        setProblem(SCANNER_FAILED);
        return;
      }
      if (stream.current !== s) return; // stopped meanwhile
      if (text !== null) {
        const code = parsePairing(text);
        if (code !== null) {
          stopCamera();
          setProblem("");
          deliver(code);
          return;
        }
        setProblem(NOT_PAIRING);
      }
      timer.current = setTimeout(() => void tick(), SCAN_EVERY_MS);
    };
    timer.current = setTimeout(() => void tick(), SCAN_EVERY_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [scanning]);

  function submitPasted(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const code = parsePairing(pasted);
    setPasted("");
    if (code === null) {
      setProblem(NOT_PAIRING);
      return;
    }
    setProblem("");
    stopCamera();
    deliver(code);
  }

  return (
    <div className="pairing-scan">
      {scanning ? (
        <>
          <video ref={videoRef} className="pairing-camera" aria-label="Camera" playsInline muted autoPlay />
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={stopCamera}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button type="button" className="btn-secondary" disabled={busy || starting} onClick={() => void start()}>
            Scan pairing code
          </button>
        </div>
      )}
      <form onSubmit={submitPasted}>
        <label className="form-field">
          <span className="form-label">Paste pairing code</span>
          {/* A plain field (review M5): a password field lets the browser offer to save the code. */}
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" className="btn-secondary" disabled={busy || !pasted}>
            Use pairing code
          </button>
        </div>
      </form>
      {problem && <p role="alert">{problem}</p>}
    </div>
  );
}
