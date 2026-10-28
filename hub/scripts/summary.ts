// The readable summary for Esme (it contains her titles and stays on her Mac).
import type { BackupFile } from "../src/data/backup";
import { AREA_IDS, type AreaId, type ISODate } from "../src/domain/types";
import type { SkippedDuplicate } from "../src/import/googleTasks";
import type { ParseNote, ProposedGoal, ProposedTask } from "../src/import/obsidianGoals";

/** Area names for the summary (the same names the app shows). */
const AREA_LABEL: Record<AreaId, string> = {
  inbox: "Inbox",
  writing: "Writing",
  art: "Art",
  content: "Content",
  mind: "Mind",
  body: "Body",
  tech: "Tech projects",
  production: "Production",
  admin: "Admin",
};
const label = (a: AreaId) => AREA_LABEL[a] ?? a;

export function makeSummary(s: {
  extraItems: number;
  extraGoals: number;
  today: ISODate;
  backup: BackupFile;
  monthGoals: ProposedGoal[];
  monthTasks: ProposedTask[];
  habitTasks: ProposedTask[];
  metrics: { name: string; current: number; target: number }[];
  weekly: string[];
  duplicates: SkippedDuplicate[];
  notes: ParseNote[];
  sorted: { title: string; areaId: AreaId }[];
  stillInInbox: number;
  goalsAsProposed: ProposedGoal[];
}): string {
  const L: string[] = [];
  L.push(`# Esmeworld transfer summary, ${s.today}`, "");
  L.push("This file is for you only. It contains your own titles and stays on this Mac.", "");

  L.push("## Items by area", "");
  for (const id of AREA_IDS) {
    const n = s.backup.items.filter((i) => i.areaId === id).length;
    if (n) L.push(`- ${label(id)}: ${n}`);
  }
  L.push(`- Total items: ${s.backup.items.length}`, "");

  L.push("## Goals", "");
  if (!s.backup.goals.length) L.push("No goals.");
  for (const g of s.backup.goals) {
    const when = g.deadline ? `, deadline ${g.deadline}` : "";
    L.push(`- ${g.title}: ${label(g.areaId)}, ${g.kind}${when}, ${g.milestones.length} milestones`);
  }
  L.push("");

  L.push("## Monthly goals and next steps", "");
  if (!s.monthGoals.length) L.push("None.");
  for (const g of s.monthGoals) {
    L.push(`- ${g.title} (deadline ${g.deadline ?? "none"})`);
    for (const t of s.monthTasks.filter((t) => t.goalKey === g.key)) L.push(`  - Next step: ${t.title}`);
  }
  L.push("");

  L.push("## Daily habits", "");
  if (!s.habitTasks.length) L.push("None.");
  for (const h of s.habitTasks) L.push(`- ${h.title} (every day)`);
  L.push("");

  if (s.metrics.length || s.weekly.length) {
    L.push("## Big goal numbers and this week (not transferred)", "");
    for (const m of s.metrics) L.push(`- ${m.name}: ${m.current} of ${m.target}`);
    for (const w of s.weekly) L.push(`- ${w}`);
    L.push("");
  }

  const needsCheck = s.backup.items.filter((i) => i.tags?.includes("check"));
  L.push("## Vault review", "", `${s.extraItems} items and ${s.extraGoals} goals came from the vault review.`, "");
  if (needsCheck.length) {
    L.push("Items that need your decision:");
    for (const i of needsCheck) L.push(`- ${i.title}: ${(i.notes ?? "").split("\n")[0]}`);
    L.push("");
  }

  L.push("## Google Tasks skipped as the same title", "");
  if (!s.duplicates.length) L.push("None.");
  for (const d of s.duplicates) {
    const why = d.reason === "existing" ? "matches a transferred item" : "repeated in the Google file";
    L.push(
      `- ${d.title} (from ${d.listTitle})${d.hadNotes ? " - had notes" : ""}${d.hadDue ? " - had a due date" : ""} - ${why}`,
    );
  }
  L.push("");

  L.push("## Sorted for you", "");
  if (!s.sorted.length) L.push("Nothing was re-filed by an areas file.");
  for (const x of s.sorted) L.push(`- ${x.title} -> ${label(x.areaId)}`);
  L.push("");

  L.push("## Still in your Inbox", "", `${s.stillInInbox} items. Sort them in Esmeworld with the area buttons.`, "");

  L.push("## Notes", "");
  if (!s.notes.length) L.push("None.");
  for (const n of s.notes) L.push(n.line ? `- ${n.reason}: ${n.line}` : `- ${n.reason}`);
  L.push("");

  L.push(
    "## How to load this",
    "",
    "1. Open Esmeworld and go to Backup.",
    "2. Choose the transfer .json file next to this summary.",
    "3. Choose Merge (not Replace).",
    "4. Load it ONCE, into ONE place: the hosted app. Sync will copy it to your other devices later.",
    "5. Do not also import the same notes through the Inbox, or you will get duplicates.",
    "",
  );
  return L.join("\n");
}

