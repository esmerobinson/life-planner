import { useEffect, useMemo, useRef, useState } from "react";
import { parsePairingText, pairingText } from "../pairing/pairingText";
import { qrModules, qrPath, readFrame } from "../pairing/qr";

/** Placeholder copy (Esme may reword). */
export const PAIRING_WARNING = "Anyone who scans this can open your Esmeworld. Only show it to your own devices.";
export const CAMERA_DENIED = "Allow the camera in Settings, or paste the code instead.";
export const NO_CAMERA = "The camera didn't start here. Paste the code instead.";
export const NOT_PAIRING = "That isn't an Esmeworld pairing code.";

/** How often a camera frame is read while scanning, in ms (a technical rate, not an animation). */
const SCAN_EVERY_MS = 150;

/**
 * The pairing code for `passphrase` as a black-on-white QR code (SVG), the warning and Hide.
 * The passphrase is only in the drawn modules: never in an attribute, label or text here.
 */
export function PairingCode({ passphrase, onHide }: { passphrase: string; onHide: () => void }) {
  const { n, d } = useMemo(() => {
    const m = qrModules(pairingText(passphrase));
    return { n: m.length, d: qrPath(m) };
  }, [passphrase]);
  return (
    <div className="pairing-code">
      {/* The modules include the 4-module quiet zone; the white square fills it. */}
      <svg
        role="img"
        aria-label="Pairing code"
        className="pairing-qr"
        viewBox={`0 0 ${n} ${n}`}
        width={240}
        height={240}
        shapeRendering="crispEdges"
      >
        <rect x={0} y={0} width={n} height={n} fill="#ffffff" />
        <path d={d} fill="#000000" />
      </svg>
      <p>{PAIRING_WARNING}</p>
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
  const [pasted, setPasted] = useState("");
  const [problem, setProblem] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  // The latest callback, so a code read by the camera loop uses the page as it is now.
  const onPass = useRef(onPassphrase);
  onPass.current = onPassphrase;

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
      release();
    };
  }, []);

  async function start() {
    if (busy || scanning) return;
    setProblem("");
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setProblem(NO_CAMERA);
      return;
    }
    let s: MediaStream;
    try {
      // Called straight from the tap, before anything else is awaited (iOS needs the gesture).
      s = await media.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    } catch (e) {
      const name = e instanceof Error || e instanceof DOMException ? e.name : "";
      setProblem(name === "NotAllowedError" || name === "SecurityError" ? CAMERA_DENIED : NO_CAMERA);
      return;
    }
    if (!mounted.current) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
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
        text = await readFrame(video);
      } catch {
        text = null;
      }
      if (stream.current !== s) return; // stopped meanwhile
      if (text !== null) {
        const passphrase = parsePairingText(text);
        if (passphrase !== null) {
          stopCamera();
          setProblem("");
          void onPass.current(passphrase);
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
    void onPassphrase(passphrase);
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
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void start()}>
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
