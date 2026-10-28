import { AREA_IDS, type AreaId } from "../domain/types";
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
import tech from "../assets/icons/tech.svg";
import production from "../assets/icons/production.svg";
import admin from "../assets/icons/admin.svg";

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
  { id: "tech", label: "Tech projects", path: "/area/tech", icon: tech, tile: "#cedb6e", group: 2 },
  { id: "production", label: "Production", path: "/area/production", icon: production, tile: "#d59770", group: 2 },
  { id: "admin", label: "Admin", path: "/area/admin", icon: admin, tile: "#90825b", group: 2 },
  { id: "journal", label: "Journal", path: "/journal", icon: journal, tile: "#9285c5", group: 3 },
  { id: "vision", label: "Vision board", path: "/vision", icon: vision, tile: "#ecca7d", group: 3 },
];

/** Area choices for forms: every area in AREA_IDS order (the inbox first), labels from NAV. */
export const AREA_CHOICES: { id: AreaId; label: string }[] = AREA_IDS.map((id) => ({
  id,
  label: id === "inbox" ? "Inbox" : NAV.find((n) => n.id === id)!.label,
}));

/** Areas that have a page and can own goals: AREA_CHOICES without the inbox. */
export const GOAL_AREAS = AREA_CHOICES.filter((a) => a.id !== "inbox");
