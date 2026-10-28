/** The one list of area ids. Nothing else may hard-code it; derive from this. */
export const AREA_IDS = [
  "inbox", "writing", "art", "content", "mind", "body", "tech", "production", "admin",
] as const;
export type AreaId = (typeof AREA_IDS)[number];
export type Priority = 1 | 2 | 3;
/** The one lists of weekdays and item sources. Validators derive from these. */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const SOURCE_KINDS = ["backlog", "manual", "gtasks"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type ISODate = string;

export interface Item {
  id: string;
  kind: "task" | "idea";
  title: string;
  notes?: string;
  links: string[];
  tags?: string[];
  areaId: AreaId;
  goalId?: string;
  priority: Priority;
  due?: ISODate;
  recur?: Weekday[];
  status: "open" | "done" | "archived";
  pinnedDate?: ISODate;
  weekOf?: ISODate;
  hiddenOn?: ISODate;
  completedAt?: ISODate;
  createdAt: ISODate;
  touchedAt: ISODate;
  source?: { kind: SourceKind; key: string };
}

export interface Milestone {
  id: string;
  title: string;
  done: boolean;
}

export interface Goal {
  id: string;
  title: string;
  areaId: AreaId;
  kind: "finite" | "practice";
  deadline?: ISODate;
  monthlyTarget?: number;
  milestones: Milestone[];
  createdAt: ISODate;
}
