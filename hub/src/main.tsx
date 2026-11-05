import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installAppUpdateHooks } from "./native/appUpdate";
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

// The Mac app flushes through these before reloading onto a new version (bug #39).
installAppUpdateHooks();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
