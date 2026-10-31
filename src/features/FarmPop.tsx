import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Render outside the farm list so its scrolling viewport cannot clip the details. */
export function FarmPop({ icon, title, rows }: { icon: string; title: string; rows: [string, string][] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = panel.current.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - 12));
    const below = anchor.bottom + 8;
    const top = below + box.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - box.height - 8);
    setPosition({ left, top });
  }, [open, rows]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    const outside = (event: Event) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) dismiss();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { dismiss(); trigger.current?.focus(); } };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) dismiss();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  return <span className="farm-pop">
    <button ref={trigger} className="farm-pop-btn" type="button" aria-label={title}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined}
      onClick={() => setOpen(current => !current)}>
      {icon}
    </button>
    {open && createPortal(<span ref={panel} id={id} role="tooltip" className="farm-pop-panel farm-pop-portal"
      style={position}>
      <span className="farm-pop-title">{icon} {title}</span>
      {rows.map(([key, value]) => <span className="farm-pop-row" key={key}><span>{key}:</span><b>{value}</b></span>)}
    </span>, document.body)}
  </span>;
}
