export type AreaId = "writing" | "art" | "content" | "mind" | "body" | "inbox";
export type Priority = 1 | 2 | 3;
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
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
  source?: { kind: "backlog" | "manual"; key: string };
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
