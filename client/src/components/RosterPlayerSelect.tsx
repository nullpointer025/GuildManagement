import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Player } from "../types";

interface RosterPlayerSelectProps {
  // "" = not picked yet, "ignore" = leave this row out, otherwise a player id.
  value: string;
  players: Player[];
  onChange: (value: string) => void;
  className?: string;
}

interface Option {
  value: string;
  label: string;
  note?: string;
}

const IGNORE: Option = { value: "ignore", label: "Ignore this row" };

// A roster-player dropdown with a search box, for long rosters where scrolling a
// plain <select> is slow. The list is portalled to <body> and fixed-positioned so
// the scrolling review table doesn't clip it and a faded (ignored) row doesn't
// fade it too.
export function RosterPlayerSelect({ value, players, onChange, className = "" }: RosterPlayerSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, up: false });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const options = useMemo<Option[]>(() => {
    const q = search.trim().toLowerCase();
    const matches = players
      .filter((p) => !q || p.ign.toLowerCase().includes(q))
      .sort((a, b) => {
        if (q) {
          const rank = (p: Player) => (p.ign.toLowerCase().startsWith(q) ? 0 : 1);
          if (rank(a) !== rank(b)) return rank(a) - rank(b);
        }
        return 0;
      })
      .map((p) => ({ value: String(p.id), label: p.ign, note: p.active === 1 ? undefined : "left guild" }));
    return q && !IGNORE.label.toLowerCase().includes(q) ? matches : [IGNORE, ...matches];
  }, [players, search]);

  const selected = value === "ignore" ? IGNORE : players.find((p) => String(p.id) === value);
  const selectedLabel = selected ? ("ign" in selected ? selected.ign : selected.label) : "— pick a player —";

  function openList() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const up = window.innerHeight - rect.bottom < 300 && rect.top > window.innerHeight - rect.bottom;
    setPos({ top: up ? rect.top : rect.bottom, left: rect.left, width: Math.max(rect.width, 240), up });
    setSearch("");
    setActive(0);
    setOpen(true);
  }

  function choose(option: Option) {
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function handlePointer(e: PointerEvent) {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    }
    function handleScroll(e: Event) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointer);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (options[active]) choose(options[active]);
    } else if (e.key === "Escape") {
      // Close only this list, not the modal around it.
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openList())}
        className={["flex items-center justify-between gap-2 text-left", className].join(" ")}
      >
        <span className={["truncate", selected ? "" : "text-ink-dim"].join(" ")}>{selectedLabel}</span>
        <span className="shrink-0 text-xs text-ink-dim" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
            }}
            className="z-[60] flex max-h-72 flex-col rounded-lg border border-border bg-panel shadow-2xl shadow-black/50"
          >
            <div className="border-b border-border-soft p-2">
              <input
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActive(0);
                }}
                onKeyDown={handleKey}
                placeholder="Search players…"
                className="w-full rounded-md border border-border bg-panel-alt px-2 py-1 text-sm text-ink outline-none focus:border-gold"
              />
            </div>
            <ul ref={listRef} className="overflow-y-auto py-1">
              {options.length === 0 && <li className="px-3 py-2 text-sm text-ink-dim">No matching players.</li>}
              {options.map((o, i) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => choose(o)}
                    onMouseEnter={() => setActive(i)}
                    className={[
                      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm",
                      i === active ? "bg-gold/15 text-heading" : "text-ink",
                      o.value === value ? "font-semibold text-gold" : "",
                      o === IGNORE ? "italic text-ink-dim" : "",
                    ].join(" ")}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.note && <span className="shrink-0 text-xs text-ink-dim">{o.note}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </>
  );
}
