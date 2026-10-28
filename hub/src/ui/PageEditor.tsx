import Dexie from "dexie";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { addPicture, getFile } from "../data/repo";
import { MAX_NOTES_TEXT } from "../data/validate";
import {
  cleanLink, continuation, linkify, NEW_LINE, parseLine, pictureLine, toggleCheckLine, withText, type Block, type BlockType,
} from "../domain/page";
import type { FileRow, ISODate } from "../domain/types";
import { downscalePicture, PICTURE_UNREADABLE } from "./picture";
import { ShellContext } from "./shellContext";

// The page (round 3b): a small block editor over the item's / goal's Markdown notes. One
// block per line (domain/page.ts). A line shows formatted (headings, ticks, links,
// pictures) until it is clicked or tabbed to; then it is a plain text field holding just
// the words after its marker, so typing never touches the Markdown around it. Typing a
// marker ("# ", "- [ ] ", "- ") at the start of a line turns it into that block, and the
// add-buttons and the "/" menu do the same. Every change goes out as the whole notes text.

/** Wording (provisional, one place). */
export const PAGE_WORDS = {
  placeholder: "Start typing… use / for a heading, checklist, link or picture.",
  add: "Add:",
  linkLabel: "Link",
  linkPlaceholder: "Paste a link",
  linkAdd: "Add link",
  cancel: "Cancel",
  notALink: "That is not a web or Obsidian link.",
  full: `This page is full (${MAX_NOTES_TEXT.toLocaleString("en-GB")} characters).`,
  adding: "Adding the picture…",
  notSaved: "That picture could not be saved. Try again.",
  removePicture: "Remove picture",
  pictureWaiting: "Picture on its way",
  pictureGone: "Picture deleted",
  menu: "Add to the page",
} as const;

type Command = "heading" | "checklist" | "link" | "picture";
const COMMANDS: { id: Command; label: string }[] = [
  { id: "heading", label: "Heading" },
  { id: "checklist", label: "Checklist" },
  { id: "link", label: "Link" },
  { id: "picture", label: "Picture" },
];

const LINE_NAME: Record<BlockType, string> = {
  p: "text", h1: "heading", h2: "heading", check: "checklist item", bullet: "list item", picture: "picture",
};

interface Row {
  key: string;
  line: string;
}

let keySeq = 0;
const newKey = () => `line-${++keySeq}`;
const rowsOf = (md: string): Row[] => md.split("\n").map((line) => ({ key: newKey(), line }));
const textOf = (rows: Row[]) => rows.map((r) => r.line).join("\n");

interface Slash {
  key: string;
  /** Where the "/" is in the line's text. */
  start: number;
  query: string;
  index: number;
}

const matching = (query: string) => COMMANDS.filter((c) => c.label.toLowerCase().startsWith(query.toLowerCase()));

export function PageEditor({
  value,
  onChange,
  onBlur,
  today,
  maxLength = MAX_NOTES_TEXT,
  label = "Notes",
}: {
  value: string;
  onChange: (text: string) => void;
  /** Focus left the page (save now). */
  onBlur: () => void;
  today: ISODate;
  maxLength?: number;
  label?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => rowsOf(value));
  const rowsRef = useRef(rows);
  const emitted = useRef(value);
  const [active, setActiveState] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  /** The line the add-buttons work from (the last one typed in). */
  const lastKey = useRef<string | null>(null);
  const focusReq = useRef<{ key: string; caret: number } | null>(null);
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  const [slash, setSlash] = useState<Slash | null>(null);
  const [linkForm, setLinkForm] = useState<{ key: string | null; at?: number } | null>(null);
  const [linkText, setLinkText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pictureAfter = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  function setActive(key: string | null) {
    activeRef.current = key;
    if (key) lastKey.current = key;
    setActiveState(key);
  }

  // A new stored text (sync, another tab, a reset) replaces the lines; what this page
  // sent itself is already shown.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    // Lines keep their place (and the one being typed in stays open) where they still exist.
    const before = rowsRef.current;
    const next = value.split("\n").map((line, i) => ({ key: before[i]?.key ?? newKey(), line }));
    rowsRef.current = next;
    setRows(next);
    if (activeRef.current && !next.some((r) => r.key === activeRef.current)) setActive(null);
    setSlash(null);
  }, [value]);

  // Put the caret where an edit asked for it, once the line's field exists.
  useLayoutEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    const el = areas.current.get(req.key);
    if (!el) return;
    focusReq.current = null;
    if (document.activeElement !== el) el.focus();
    el.setSelectionRange(req.caret, req.caret);
  });

  /** Applies new lines and sends the notes out. False when it would overfill the page. */
  function commit(next: Row[], focus?: { key: string; caret: number }): boolean {
    const text = textOf(next);
    if (text.length > maxLength && text.length > textOf(rowsRef.current).length) {
      setMessage(PAGE_WORDS.full);
      return false;
    }
    if (message === PAGE_WORDS.full) setMessage(null);
    rowsRef.current = next;
    setRows(next);
    if (focus) {
      focusReq.current = focus;
      setActive(focus.key);
    }
    if (text !== emitted.current) {
      emitted.current = text;
      onChange(text);
    }
    return true;
  }

  const indexOf = (key: string | null) => (key ? rowsRef.current.findIndex((r) => r.key === key) : -1);

  /** Starts typing in a line (synchronously, so the phone keyboard opens on the tap). */
  function activate(key: string, caret: number) {
    flushSync(() => setActive(key));
    const el = areas.current.get(key);
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  }

  function replaceLine(key: string, line: string, caret?: number) {
    const next = rowsRef.current.map((r) => (r.key === key ? { key, line } : r));
    return commit(next, caret === undefined ? undefined : { key, caret });
  }

  /**
   * Puts a new line after the line last typed in (or at the end); an empty text line is
   * used instead of adding another. Focuses it when it is a text line.
   */
  function placeLine(line: string, after: string | null = lastKey.current) {
    const rs = rowsRef.current;
    let idx = indexOf(after);
    if (idx === -1) idx = rs.length - 1;
    const target = rs[idx];
    const block = parseLine(line);
    const focus = block.type === "picture" ? undefined : block.text.length;
    if (target && target.line === "") {
      replaceLine(target.key, line, focus);
      if (block.type === "picture") lastKey.current = target.key;
      return;
    }
    const key = newKey();
    commit([...rs.slice(0, idx + 1), { key, line }, ...rs.slice(idx + 1)], focus === undefined ? undefined : { key, caret: focus });
    if (block.type === "picture") lastKey.current = key;
  }

  function removeLine(key: string) {
    const rs = rowsRef.current.filter((r) => r.key !== key);
    commit(rs.length ? rs : [{ key: newKey(), line: "" }]);
  }

  // ---- commands (add-buttons and "/") -----------------------------------------------------

  /** Runs a command; from the "/" menu, the "/query" typed is taken out of the line first. */
  function run(cmd: Command, from: Slash | null) {
    setSlash(null);
    setMessage(null);
    let at: { key: string; text: string; caret: number; block: Block } | null = null;
    if (from) {
      const row = rowsRef.current.find((r) => r.key === from.key);
      if (row) {
        const block = parseLine(row.line);
        const end = from.start + 1 + from.query.length;
        at = { key: row.key, text: block.text.slice(0, from.start) + block.text.slice(end), caret: from.start, block };
      }
    }
    if (cmd === "heading" || cmd === "checklist") {
      const marker = cmd === "heading" ? NEW_LINE.heading : NEW_LINE.checklist;
      if (at) replaceLine(at.key, marker + at.text, at.caret);
      else placeLine(marker);
      return;
    }
    if (at) replaceLine(at.key, withText(at.block, at.text), at.caret);
    if (cmd === "link") {
      setLinkText("");
      setLinkForm(at ? { key: at.key, at: at.caret } : { key: lastKey.current });
      return;
    }
    pictureAfter.current = at ? at.key : lastKey.current;
    fileInput.current?.click();
  }

  function addLink() {
    const url = cleanLink(linkText);
    if (!url) {
      setMessage(PAGE_WORDS.notALink);
      return;
    }
    const form = linkForm;
    setLinkForm(null);
    setMessage(null);
    const row = form?.key ? rowsRef.current.find((r) => r.key === form.key) : undefined;
    if (row && form?.at !== undefined) {
      // From "/": the link goes where the "/" was.
      const block = parseLine(row.line);
      const before = block.text.slice(0, form.at);
      const after = block.text.slice(form.at);
      const text = `${before}${before && !/\s$/.test(before) ? " " : ""}${url}${after && !/^\s/.test(after) ? " " : ""}${after}`;
      replaceLine(row.key, withText(block, text), before.length + url.length + (before && !/\s$/.test(before) ? 1 : 0));
      return;
    }
    placeLine(url, form?.key ?? null);
  }

  async function pickedPicture(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      let picture;
      try {
        picture = await downscalePicture(file);
      } catch {
        setMessage(PICTURE_UNREADABLE);
        return;
      }
      try {
        const id = await addPicture(picture, today);
        placeLine(pictureLine(id), pictureAfter.current);
      } catch {
        setMessage(PAGE_WORDS.notSaved);
      }
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  // ---- typing ------------------------------------------------------------------------------

  function typed(row: Row, block: Block, el: HTMLTextAreaElement) {
    const typedText = el.value;
    const caret = el.selectionStart ?? typedText.length;
    if (typedText.includes("\n")) {
      // Pasted lines become lines of their own (the first keeps this line's marker).
      const parts = typedText.split("\n");
      const first = withText(block, parts[0]!);
      const added = parts.slice(1).map((line) => ({ key: newKey(), line }));
      const rs = rowsRef.current;
      const i = rs.findIndex((r) => r.key === row.key);
      const last = added[added.length - 1]!;
      const lastBlock = parseLine(last.line);
      const inLast = caret - (typedText.lastIndexOf("\n") + 1);
      commit([...rs.slice(0, i), { key: row.key, line: first }, ...added, ...rs.slice(i + 1)], {
        key: last.key,
        caret: Math.max(0, Math.min(lastBlock.text.length, inLast - lastBlock.prefix.length)),
      });
      setSlash(null);
      return;
    }
    const line = withText(block, typedText);
    const now = parseLine(line);
    const prefixUsed = line.length - typedText.length;
    const changedKind = now.prefix !== line.slice(0, prefixUsed) || now.type !== block.type;
    const ok = changedKind
      ? replaceLine(row.key, line, Math.max(0, Math.min(now.text.length, prefixUsed + caret - now.prefix.length)))
      : replaceLine(row.key, line);
    if (!ok) return;
    if (now.type === "picture") {
      setActive(null);
      setSlash(null);
      return;
    }
    // The "/" menu: opened by "/" at the start or after a space; the letters after it filter.
    const text = now.text;
    const at = changedKind ? caret - (now.prefix.length - prefixUsed) : caret;
    if (slash && slash.key === row.key) {
      const query = text.slice(slash.start + 1, at);
      if (at <= slash.start || text[slash.start] !== "/" || /\s/.test(query) || matching(query).length === 0) setSlash(null);
      else setSlash({ ...slash, query, index: Math.min(slash.index, matching(query).length - 1) });
    } else if (typedText.length === block.text.length + 1 && text[at - 1] === "/" && (at === 1 || /\s/.test(text[at - 2]!))) {
      setSlash({ key: row.key, start: at - 1, query: "", index: 0 });
    }
  }

  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>, row: Row, block: Block) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const text = block.text;
    const rs = rowsRef.current;
    const i = rs.findIndex((r) => r.key === row.key);

    if (slash && slash.key === row.key) {
      const options = matching(slash.query);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setSlash({ ...slash, index: (slash.index + step + options.length) % options.length });
        return;
      }
      if (e.key === "Enter" && options.length > 0) {
        e.preventDefault();
        run(options[slash.index]!.id, slash);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault(); // closes the menu, not the panel
        setSlash(null);
        return;
      }
    }

    if (e.key === "Enter") {
      e.preventDefault();
      setSlash(null);
      if ((block.type === "check" || block.type === "bullet") && text === "") {
        replaceLine(row.key, "", 0); // Enter on an empty list line ends the list
        return;
      }
      if (start === 0 && end === 0 && text !== "") {
        // At the very start: a new empty line above, the caret stays put.
        const key = newKey();
        commit([...rs.slice(0, i), { key, line: continuation(block) }, ...rs.slice(i)], { key: row.key, caret: 0 });
        return;
      }
      const key = newKey();
      const next = continuation(block) + text.slice(end);
      commit(
        [...rs.slice(0, i), { key: row.key, line: withText(block, text.slice(0, start)) }, { key, line: next }, ...rs.slice(i + 1)],
        { key, caret: 0 },
      );
      return;
    }

    if (e.key === "Backspace" && start === 0 && end === 0) {
      if (block.type !== "p") {
        e.preventDefault(); // the marker goes first: the line becomes plain text
        replaceLine(row.key, text, 0);
        return;
      }
      const prev = rs[i - 1];
      if (!prev) return;
      const prevBlock = parseLine(prev.line);
      e.preventDefault();
      if (prevBlock.type === "picture") {
        if (text === "") removeLine(row.key);
        return;
      }
      commit(
        [...rs.slice(0, i - 1), { key: prev.key, line: withText(prevBlock, prevBlock.text + text) }, ...rs.slice(i + 1)],
        { key: prev.key, caret: prevBlock.text.length },
      );
      return;
    }

    if (e.key === "Delete" && start === text.length && end === text.length) {
      const nxt = rs[i + 1];
      if (!nxt) return;
      const nextBlock = parseLine(nxt.line);
      if (nextBlock.type === "picture") return;
      e.preventDefault();
      commit([...rs.slice(0, i), { key: row.key, line: withText(block, text + nextBlock.text) }, ...rs.slice(i + 2)], {
        key: row.key,
        caret: text.length,
      });
      return;
    }

    const back = (e.key === "ArrowUp" || e.key === "ArrowLeft") && start === 0 && end === 0;
    const fwd = (e.key === "ArrowDown" || e.key === "ArrowRight") && start === text.length && end === text.length;
    if (back || fwd) {
      // Step to the next text line up or down (pictures are skipped).
      for (let j = back ? i - 1 : i + 1; j >= 0 && j < rs.length; j += back ? -1 : 1) {
        const b = parseLine(rs[j]!.line);
        if (b.type === "picture") continue;
        e.preventDefault();
        setSlash(null);
        activate(rs[j]!.key, back ? b.text.length : 0);
        return;
      }
    }
  }

  /** A click on the page below the last line: type at the end (after a picture, on a new line). */
  function clickedPage(e: MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    const rs = rowsRef.current;
    const last = rs[rs.length - 1]!;
    const block = parseLine(last.line);
    if (block.type === "picture") {
      const key = newKey();
      commit([...rs, { key, line: "" }], { key, caret: 0 });
      return;
    }
    activate(last.key, block.text.length);
  }

  const onlyEmpty = rows.length === 1 && rows[0]!.line === "";

  return (
    <div
      ref={root}
      className="page"
      role="group"
      aria-label={label}
      onBlur={(e) => {
        if (root.current && e.relatedTarget instanceof Node && root.current.contains(e.relatedTarget)) return;
        onBlur();
      }}
    >
      <div className="page-lines" onClick={clickedPage}>
        {rows.map((row, i) => {
          const block = parseLine(row.line);
          if (block.type === "picture") {
            return <PictureLine key={row.key} id={block.fileId!} alt={row.line.slice(2, row.line.indexOf("]"))} onRemove={() => removeLine(row.key)} />;
          }
          const editing = active === row.key;
          return (
            <div
              key={row.key}
              className={`page-line page-${block.type}${block.done ? " is-done" : ""}`}
              style={block.indent ? { paddingLeft: `${block.indent}ch` } : undefined}
            >
              {block.type === "check" && (
                <input
                  type="checkbox"
                  className="tick page-tick"
                  checked={block.done === true}
                  aria-label={block.text ? `Done: ${block.text}` : "Done"}
                  onChange={() => replaceLine(row.key, toggleCheckLine(row.line))}
                />
              )}
              {block.type === "bullet" && <span className="page-dot" aria-hidden="true">•</span>}
              {editing ? (
                <LineField
                  text={block.text}
                  label={`${label}: ${LINE_NAME[block.type]} ${i + 1}`}
                  heading={block.type === "h1" || block.type === "h2"}
                  register={(el) => {
                    if (el) areas.current.set(row.key, el);
                    else areas.current.delete(row.key);
                  }}
                  onInput={(el) => typed(row, block, el)}
                  onKeyDown={(e) => keyDown(e, row, block)}
                  onBlur={() => {
                    if (activeRef.current !== row.key) return;
                    setActive(null);
                    setSlash(null);
                  }}
                />
              ) : (
                <LineView
                  text={block.text}
                  heading={block.type === "h1" ? 1 : block.type === "h2" ? 2 : 0}
                  placeholder={onlyEmpty ? PAGE_WORDS.placeholder : undefined}
                  onStart={(caret) => activate(row.key, caret)}
                />
              )}
              {slash?.key === row.key && (
                <div className="page-slash" aria-label={PAGE_WORDS.menu}>
                  {matching(slash.query).map((c, n) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`peek-pill${n === slash.index ? " is-current" : ""}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => run(c.id, slash)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {linkForm && (
        <div className="page-linkform">
          <input
            type="url"
            aria-label={PAGE_WORDS.linkLabel}
            placeholder={PAGE_WORDS.linkPlaceholder}
            value={linkText}
            autoFocus
            onChange={(e) => setLinkText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setLinkForm(null);
                setMessage(null);
              }
            }}
          />
          <button type="button" className="peek-pill is-done" onClick={addLink}>
            {PAGE_WORDS.linkAdd}
          </button>
          <button type="button" className="peek-pill" onClick={() => { setLinkForm(null); setMessage(null); }}>
            {PAGE_WORDS.cancel}
          </button>
        </div>
      )}

      <div className="page-add">
        <span>{PAGE_WORDS.add}</span>
        {COMMANDS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="peek-pill"
            disabled={c.id === "picture" && busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(c.id, null)}
          >
            {c.label}
          </button>
        ))}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="page-file"
          aria-label="Choose a picture"
          tabIndex={-1}
          onChange={(e) => void pickedPicture(e.target.files?.[0])}
        />
      </div>
      {(busy || message) && (
        <p className="page-note" role="status">
          {busy ? PAGE_WORDS.adding : message}
        </p>
      )}
    </div>
  );
}

/** A line being typed in: a plain field as tall as its text. */
function LineField({
  text,
  label,
  heading,
  register,
  onInput,
  onKeyDown,
  onBlur,
}: {
  text: string;
  label: string;
  heading: boolean;
  register: (el: HTMLTextAreaElement | null) => void;
  onInput: (el: HTMLTextAreaElement) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        register(el);
      }}
      rows={1}
      className={`page-field${heading ? " is-heading" : ""}`}
      aria-label={label}
      value={text}
      onChange={(e) => onInput(e.currentTarget)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}

/** A line as shown: links open (new tab, or the Obsidian app); a click elsewhere types there. */
function LineView({
  text,
  heading,
  placeholder,
  onStart,
}: {
  text: string;
  heading: 0 | 1 | 2;
  placeholder?: string;
  onStart: (caret: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const segments = linkify(text);
  return (
    <div
      ref={ref}
      className="page-text"
      tabIndex={0}
      role={heading ? "heading" : undefined}
      aria-level={heading ? heading + 2 : undefined}
      // A mouse press does not focus the shown line; the click below starts typing at the
      // spot clicked. Keyboard focus (Tab) starts typing at the end.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest("a")) e.preventDefault();
      }}
      onClick={(e) => {
        if ((e.target as Element).closest("a")) return;
        e.stopPropagation();
        onStart(caretAt(ref.current!, e.clientX, e.clientY, text.length));
      }}
      onFocus={() => onStart(text.length)}
    >
      {text === "" && placeholder ? <span className="page-placeholder">{placeholder}</span> : null}
      {segments.map((s) =>
        s.kind === "link" ? (
          <a
            key={s.start}
            href={s.href}
            target={s.href!.toLowerCase().startsWith("obsidian:") ? undefined : "_blank"}
            rel="noopener noreferrer"
            data-start={s.start}
            data-end={s.end}
            data-verbatim={s.verbatim ? "1" : "0"}
            tabIndex={-1}
          >
            {s.text}
          </a>
        ) : (
          <span key={s.start} data-start={s.start} data-end={s.end} data-verbatim="1">
            {s.text}
          </span>
        ),
      )}
    </div>
  );
}

/** Where in the line's raw text a click landed (the end when the browser cannot say). */
function caretAt(container: HTMLElement, x: number, y: number, fallback: number): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === "function") {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) [node, offset] = [p.offsetNode, p.offset];
  } else if (typeof doc.caretRangeFromPoint === "function") {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) [node, offset] = [r.startContainer, r.startOffset];
  }
  if (!node || !container.contains(node)) return fallback;
  const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest<HTMLElement>("[data-start]");
  if (!el || !container.contains(el)) return fallback;
  const start = Number(el.dataset.start);
  const end = Number(el.dataset.end);
  if (node.nodeType !== Node.TEXT_NODE) return start;
  return el.dataset.verbatim === "1" ? Math.min(start + offset, end) : end;
}

/** A picture line: the photo, or a quiet placeholder until its file row has arrived. */
function PictureLine({ id, alt, onRemove }: { id: string; alt: string; onRemove: () => void }) {
  const file = useFile(id);
  const shown = file && file.status !== "purged" && file.data !== "";
  return (
    // Focusable, so Tab reaches it and shows its (otherwise hover-only) Remove button.
    <figure className="page-pic" tabIndex={0}>
      {shown ? (
        <img src={`data:${file.mime};base64,${file.data}`} alt={alt || "Picture"} width={file.width} height={file.height} />
      ) : file === undefined ? (
        <div className="page-pic-wait" aria-hidden="true" />
      ) : (
        <div className="page-pic-wait" role="img" aria-label={file ? PAGE_WORDS.pictureGone : PAGE_WORDS.pictureWaiting}>
          {file ? PAGE_WORDS.pictureGone : PAGE_WORDS.pictureWaiting}
        </div>
      )}
      <button type="button" className="peek-pill page-pic-remove" onClick={onRemove}>
        {PAGE_WORDS.removePicture}
      </button>
    </figure>
  );
}

/** A file row, re-read when anything is written (sync brings it later on another device). */
function useFile(id: string): FileRow | null | undefined {
  const version = useContext(ShellContext)?.version ?? 0;
  const [file, setFile] = useState<FileRow | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () =>
      getFile(id).then(
        (f) => {
          if (!live) return;
          setFile((had) => (had && f && had.updatedAt === f.updatedAt && had.status === f.status ? had : (f ?? null)));
        },
        () => live && setFile(null),
      );
    void load();
    const onMutated = () => void load();
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => {
      live = false;
      Dexie.on.storagemutated.unsubscribe(onMutated);
    };
  }, [id, version]);
  return file;
}
