// Esme's Rio: what /farm shows while the game's own files (its lazily loaded chunk: the map, the
// areas, the menu and the Rio art data) arrive. The game screen's existing frame of wooden planks
// (game-screen.css) with nothing inside it yet: a placeholder, no design of its own. If the files
// never arrive the page's error guard takes over (ui/AppShell.tsx), and the chunk guard
// (native/appUpdate.ts) reloads once.

import { kitUrl } from "./ui/kit";

export function GameLoading() {
  return (
    <div className="game-screen rio-ui" data-loading="" style={{ ["--k-wood-planks" as string]: `url("${kitUrl("wood-planks")}")` }}>
      <div className="game-view">
        {/* WORDING PROVISIONAL (for Esme / Design). */}
        <p className="visually-hidden" role="status">Loading Esme's Rio</p>
      </div>
    </div>
  );
}
