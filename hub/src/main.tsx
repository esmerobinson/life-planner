import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/controls.css";
import "./styles/strips.css";
import "./styles/sort.css";
import "./styles/phone.css";
import "./styles/panel.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
