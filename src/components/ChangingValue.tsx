import { useEffect, useRef, useState, type ReactNode } from "react";
export function ChangingValue({ value, children }: { value: string | number | bigint | undefined; children: ReactNode }) {
  const previous = useRef(value);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const meaningful = previous.current !== undefined && value !== undefined && previous.current !== value;
    previous.current = value;
    if (!meaningful) return;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), 700);
    return () => clearTimeout(timer);
  }, [value]);
  return <span className={changed ? "value-change is-changing" : "value-change"}>{children}</span>;
}
