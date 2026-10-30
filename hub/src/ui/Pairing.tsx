import { useEffect, useMemo, useRef, useState } from "react";
import { parsePairingText, pairingText } from "../pairing/pairingText";
import { qrModules, qrPath, readFrame } from "../pairing/qr";

/** Placeholder copy (Esme may reword). */
export const PAIRING_WARNING = "Anyone who scans this can open your Esmeworld. Only show it to your own devices.";
export const CAMERA_DENIED = "Allow the camera in Settings, or paste the code instead.";
export const NO_CAMERA = "The camera didn't start here. Paste the code instead.";
export const NOT_PAIRING = "That isn't an Esmeworld pairing code.";
export const SCANNER_FAILED = "Couldn't start the scanner. Paste the code instead.";
export const CODE_FAILED = "Couldn't make a pairing code for this passphrase.";
export const TOO_LONG = "That passphrase is too long for a pairing code.";

/** How often a camera frame is read while scanning, in ms (a technical rate, not an animation). */
const SCAN_EVERY_MS = 150;

/** The shown code hides itself after this long (coordinator's rule, concern 1). */
export const PAIRING_SHOW_MS = 60_000;

/** "Hides in 0:45". */
export function hidesIn(seconds: number): string {
  const s = Math.max(0, seconds);
  return `Hides in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The pairing code for `passphrase` as a black-on-white QR code (SVG), the warning, a countdown
 * and Hide. The passphrase is only in the drawn modules: never in an attribute, label or text.
 * It hides itself after 60 seconds, and at once when the page or app goes to the background
 * (visibilitychange to hidden, pagehide, or the window losing focus, as the Mac app does).
 * Showing it again needs another tap.
 */
export function PairingCode({ passphrase, onHide }: { passphrase: string; onHide: () => void }) {
  const code = useMemo(() => {
    // Too long for any QR code (or any other encoder failure): a plain error, never a throw.
    try {
      const m = qrModules(pairingText(passphrase));
      return { n: m.length, d: qrPath(m) };
    } catch {
      return null;
    }
  }, [passphrase]);
  const hide = useRef(onHide);
  hide.current = onHide;
  const [left, setLeft] = useState(PAIRING_SHOW_MS / 1000);

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
  }, [passphrase]);

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
 * "Scan pairing code" (the camera) and "Paste pairing code" (a field). A valid code's
 * passphrase goes to `onPassphrase`, exactly as if it had been typed; nothing here keeps it.
 * The camera starts only from the button (a user gesture, as iOS needs) and stops as soon as a
 * pairing code is read, on Cancel, and when this leaves the page.
 */
export function ScanPairingCode({ onPassphrase, busy = false }: { onPassphrase: (passphrase: string) => unknown; busy?: boolean }) {
  const [scanning, setScanning] = useState(false);
  // getUserMedia is pending: Scan is disabled, and a second tap never asks again.
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const [pasted, setPasted] = useState("");
  const [problem, setProblem] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  // The latest callback, so a code read by the camera loop uses the page as it is now.
  const onPass = useRef(onPassphrase);
  onPass.current = onPassphrase;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // A code read while the page was busy: kept (in memory only) and used once busy clears.
  const queued = useRef<string | null>(null);

  /** Hands a passphrase on now, or as soon as the page is no longer busy. */
  function deliver(passphrase: string) {
    if (busyRef.current) {
      queued.current = passphrase;
      return;
    }
    void onPass.current(passphrase);
  }

  useEffect(() => {
    if (busy || queued.current === null) return;
    const passphrase = queued.current;
    queued.current = null;
    void onPass.current(passphrase);
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
        const passphrase = parsePairingText(text);
        if (passphrase !== null) {
          stopCamera();
          setProblem("");
          deliver(passphrase);
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
    const passphrase = parsePairingText(pasted);
    setPasted("");
    if (passphrase === null) {
      setProblem(NOT_PAIRING);
      return;
    }
    setProblem("");
    stopCamera();
    deliver(passphrase);
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
          <input type="password" autoComplete="off" value={pasted} onChange={(e) => setPasted(e.target.value)} />
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
