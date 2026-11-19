import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installAppUpdateHooks } from "./native/appUpdate";
import { applyWaitingBeforeFirstPaint, startPwaUpdates } from "./native/pwaRegister";
import "./styles/tokens.css";
import "./styles/controls.css";
import "./styles/strips.css";
import "./styles/streak.css";
import "./styles/sort.css";
import "./styles/vision.css";
import "./styles/journal.css";
import "./styles/phone.css";
import "./styles/add.css";
import "./styles/panel.css";
import "./styles/goals.css";
import "./styles/pairing.css";
import "./styles/reminders.css";
import "./styles/books.css";
import "./styles/search.css";
import "./styles/dailyRoutine.css";

// Which build is running (no visible UI): e.g. to tell whether the phone has taken a new one.
document.documentElement.dataset.build = __ESMEWORLD_BUILD__;

// The Mac app flushes through these before reloading onto a new version (bug #39).
installAppUpdateHooks();
// A version already waiting at a cold open is taken before anything is drawn (no flash); then the
// phone's home-screen app takes new versions by itself, at a safe moment (native/pwaUpdate.ts).
void applyWaitingBeforeFirstPaint()
  .catch(() => false) // never leave the app undrawn
  .then((reloading) => {
    if (reloading) return;
    startPwaUpdates();
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
