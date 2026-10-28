import Dexie, { type Table } from "dexie";
import type { Item, Goal } from "../domain/types";

export class HubDB extends Dexie {
  items!: Table<Item, string>;
  goals!: Table<Goal, string>;

  constructor() {
    super("life-hub");
    this.version(1).stores({
      items: "id, status, areaId, goalId, due",
      goals: "id",
    });
  }
}

export const db = new HubDB();
