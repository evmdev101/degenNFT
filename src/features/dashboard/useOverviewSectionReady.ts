import { useEffect, useRef, useState } from "react";

/** Leave the first screen's reads free to finish before loading deeper panels. */
export function useOverviewSectionReady() {
  const ref = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") { setReady(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setReady(true); observer.disconnect(); }
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ready]);
  return { ref, ready };
}
