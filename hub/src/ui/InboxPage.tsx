import { useContext, useState } from "react";
import { updateItem } from "../data/repo";
import type { AreaId, ISODate, Item, Priority } from "../domain/types";
import { AREA_CHOICES } from "./areas";
import { ImportPanel } from "./ImportPanel";
import { SAVE_ERROR } from "./messages";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

const FILE_AREAS = AREA_CHOICES.filter((a) => a.id !== "inbox");

function InboxRow({
  item,
  today,
  goals,
  onFiled,
}: {
  item: Item;
  today: ISODate;
  goals: { id: string; title: string; areaId: AreaId }[];
  onFiled: () => void | Promise<void>;
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
        <ul aria-label="Inbox items">
          {inbox.map((it) => (
            <InboxRow key={it.id} item={it} today={today} goals={goals} onFiled={changed} />
          ))}
        </ul>
      )}
    </section>
  );
}
