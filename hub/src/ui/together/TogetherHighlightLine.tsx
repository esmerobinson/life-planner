import { TOGETHER_WORDS as W } from "./wording";
import "./together.css";

/** PLACEHOLDER look and wording (Design / Esme): on the Highlight sheet, what goes to Together. */
export function TogetherHighlightLine() {
  return (
    <div className="together-placeholder together-highlight-line">
      <p>{W.highlightsGo}</p>
      <p>{W.laterNote}</p>
    </div>
  );
}
