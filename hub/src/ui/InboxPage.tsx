import { useContext, useState } from "react";
import { updateItem, updateItems } from "../data/repo";
import type { AreaId, ISODate, Item, Priority } from "../domain/types";
import { AREA_CHOICES, GOAL_AREAS } from "./areas";
import { ImportPanel } from "./ImportPanel";
import { SAVE_ERROR, useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

const FILE_AREAS = AREA_CHOICES.filter((a) => a.id !== "inbox");

function InboxRow({
  item,
  today,
  goals,
  onFiled,
  selected,
  onToggle,
}: {
  item: Item;
  today: ISODate;
  goals: { id: string; title: string; areaId: AreaId }[];
  onFiled: () => void | Promise<void>;
  selected: boolean;
  onToggle: () => void;
}) {
  const [areaId, setAreaId] = useState<AreaId | "">("");
  const [goalId, setGoalId] = useState("");
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [due, setDue] = useState(item.due ?? "");
  const [message, setMessage] = useState("");

  async function file() {
    if (!areaId) {
      setMessage("Choose an area first.");
      return;
    }
    setMessage("");
    try {
      await updateItem(
        item.id,
        { areaId, goalId: goalId || undefined, priority, due: due || undefined },
        today,
      );
    } catch {
      setMessage(SAVE_ERROR);
      return;
    }
    await onFiled();
  }

  return (
    <li className="inbox-row">
      <input
        type="checkbox"
        aria-label={`Select ${item.title}`}
        checked={selected}
        onChange={onToggle}
      />
      <span className="inbox-title">{item.title}</span>
      {item.tags?.map((t) => (
        <span key={t} className="inbox-tag">
          #{t}
        </span>
      ))}
      <label>
        Area
        <select
          aria-label={`Area for ${item.title}`}
          value={areaId}
          onChange={(e) => {
            setAreaId(e.target.value as AreaId);
            setGoalId("");
          }}
        >
          <option value="">Choose</option>
          {FILE_AREAS.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Goal
        <select
          aria-label={`Goal for ${item.title}`}
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
        >
          <option value="">None</option>
          {goals
            .filter((g) => g.areaId === areaId)
            .map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
        </select>
      </label>
      <label>
        Priority
        <select
          aria-label={`Priority for ${item.title}`}
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value) as Priority)}
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
      </label>
      <label>
        Due
        <input
          type="date"
          aria-label={`Due for ${item.title}`}
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <button type="button" aria-label={`File ${item.title}`} onClick={() => void file()}>
        File it
      </button>
      {message && <span className="form-message">{message}</span>}
    </li>
  );
}

export function InboxPage({ today }: { today: ISODate }) {
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const shell = useContext(ShellContext);
  const inbox = items.filter((i) => i.areaId === "inbox" && i.status === "open");

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveArea, setMoveArea] = useState<AreaId | "">("");
  const { attempt, saveError } = useSaveError();
  const shownPicked = inbox.filter((i) => picked.has(i.id));

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function moveSelected() {
    if (!moveArea || shownPicked.length === 0) return;
    const ok = await attempt(() => updateItems(shownPicked.map((i) => i.id), { areaId: moveArea }, today));
    if (!ok) return;
    setPicked(new Set());
    await changed();
  }

  async function changed() {
    await refresh();
    await shell?.refresh();
  }

  if (error) {
    return (
      <section className="inbox-page">
        <h1>Inbox</h1>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <section className="inbox-page">
      <h1>Inbox</h1>
      <ImportPanel today={today} onImported={() => void changed()} />
      {loaded && inbox.length === 0 && <p>Nothing waiting in the inbox.</p>}
      {inbox.length > 0 && (
        <div className="inbox-bulk">
          <label>
            <input
              type="checkbox"
              aria-label="Select all shown"
              checked={shownPicked.length === inbox.length}
              onChange={(e) => setPicked(e.target.checked ? new Set(inbox.map((i) => i.id)) : new Set())}
            />
            Select all shown
          </label>
          <label>
            Move selected to
            <select
              aria-label="Move selected to"
              value={moveArea}
              onChange={(e) => setMoveArea(e.target.value as AreaId | "")}
            >
              <option value="">Choose</option>
              {GOAL_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!moveArea || shownPicked.length === 0}
            onClick={() => void moveSelected()}
          >
            Move selected
          </button>
          {saveError && <span className="form-message">{saveError}</span>}
        </div>
      )}
      {inbox.length > 0 && (
        <ul aria-label="Inbox items">
          {inbox.map((it) => (
            <InboxRow key={it.id} item={it} today={today} goals={goals}
              onFiled={changed}
              selected={picked.has(it.id)}
              onToggle={() => toggle(it.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
