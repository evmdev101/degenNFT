import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./scroll-region.css";

type ScrollRegionProps = {
  children: ReactNode;
  label: string;
  id?: string;
  className?: string;
  contentClassName?: string;
  resetKey?: string | number | boolean;
};

/** One native scroll owner per collection; the surrounding controls stay on the page. */
export function ScrollRegion({ children, label, id, className = "", contentClassName = "", resetKey }: ScrollRegionProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = viewport.current;
    const inner = content.current;
    if (!element || !inner) return;
    const measure = () => setOverflowing(
      element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1,
    );
    measure();
    // Also watches expanded record details, late-loading images and changing rows.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    observer?.observe(inner);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (!viewport.current) return;
    viewport.current.scrollTop = 0;
    viewport.current.scrollLeft = 0;
  }, [resetKey]);

  return <div className="scroll-region-shell">
    <div ref={viewport} id={id} className={`scroll-region ${className}`.trim()}
      role="region" aria-label={label} tabIndex={overflowing ? 0 : undefined}
      aria-describedby={overflowing ? hintId : undefined}>
      <div ref={content} className={`scroll-region-content ${contentClassName}`.trim()}>{children}</div>
    </div>
    {overflowing && <p className="scroll-region-hint" id={hintId}>Scroll within this list to see more</p>}
  </div>;
}
