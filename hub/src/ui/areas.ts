import type { AreaId } from "../domain/types";
import home from "../assets/icons/home.svg";
import today from "../assets/icons/today.svg";
import goals from "../assets/icons/goals.svg";
import writing from "../assets/icons/writing.svg";
import art from "../assets/icons/art.svg";
import content from "../assets/icons/content.svg";
import mind from "../assets/icons/mind.svg";
import body from "../assets/icons/body.svg";
import journal from "../assets/icons/journal.svg";
import vision from "../assets/icons/vision-board.svg";

export type NavEntry = {
  id: string;
  label: string;
  path: string;
  icon: string;
  tile: string;
  group: 1 | 2 | 3;
};

export const NAV: NavEntry[] = [
  { id: "home", label: "Home", path: "/", icon: home, tile: "#9eb4e6", group: 1 },
  { id: "today", label: "Today", path: "/today", icon: today, tile: "#e8dd6e", group: 1 },
  { id: "goals", label: "Goals", path: "/goals", icon: goals, tile: "#98c293", group: 1 },
  { id: "writing", label: "Writing", path: "/area/writing", icon: writing, tile: "#e6aeaf", group: 2 },
  { id: "art", label: "Art", path: "/area/art", icon: art, tile: "#a6ced6", group: 2 },
  { id: "content", label: "Content", path: "/area/content", icon: content, tile: "#b693ec", group: 2 },
  { id: "mind", label: "Mind", path: "/area/mind", icon: mind, tile: "#a3d5c2", group: 2 },
  { id: "body", label: "Body", path: "/area/body", icon: body, tile: "#e39876", group: 2 },
  { id: "journal", label: "Journal", path: "/journal", icon: journal, tile: "#9285c5", group: 3 },
  { id: "vision", label: "Vision board", path: "/vision", icon: vision, tile: "#ecca7d", group: 3 },
];

/** Area choices for forms: the five sidebar areas (labels from NAV) plus the inbox. */
export const AREA_CHOICES: { id: AreaId; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  ...(["writing", "art", "content", "mind", "body"] as const).map((id) => ({
    id: id as AreaId,
    label: NAV.find((n) => n.id === id)!.label,
  })),
];
