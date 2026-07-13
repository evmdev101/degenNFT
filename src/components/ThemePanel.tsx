import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { applyTheme, THEMES, type ThemeName } from "../themes/themes";

export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = localStorage.getItem("degen-react-theme") as ThemeName | null;
    return saved && saved in THEMES ? saved : "original";
  });
  useEffect(() => {
    applyTheme(theme);
    try {
      const custom = JSON.parse(
        localStorage.getItem("degen-react-custom") || "null",
      ) as Record<string, string> | null;
      if (custom)
        Object.entries(custom).forEach(([key, value]) =>
          document.documentElement.style.setProperty(`--${key}`, value),
        );
    } catch {
      localStorage.removeItem("degen-react-custom");
    }
  }, [theme]);
  return { theme, setTheme };
}

export function ThemePanel({
  theme,
  setTheme,
}: {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}) {
  const [open, setOpen] = useState(false),
    [peek, setPeek] = useState(false),
    [tip, setTip] = useState(false),
    [tab, setTab] = useState<"themes" | "custom">("themes");
  const [custom, setCustom] = useState(() => ({ ...THEMES[theme] }));
  useEffect(() => setCustom({ ...THEMES[theme] }), [theme]);
  const setCustomColor = (
    key: "bg" | "fg" | "panel" | "border" | "accent",
    value: string,
  ) => {
    const next = { ...custom, [key]: value };
    setCustom(next);
    document.documentElement.style.setProperty(`--${key}`, value);
    localStorage.setItem(
      "degen-react-custom",
      JSON.stringify({
        bg: next.bg,
        fg: next.fg,
        panel: next.panel,
        border: next.border,
        accent: next.accent,
      }),
    );
  };
  const resetCustom = () => {
    localStorage.removeItem("degen-react-custom");
    setCustom({ ...THEMES[theme] });
    applyTheme(theme);
  };
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width?: number;
    height?: number;
  } | null>(null);
  const windowRef = useRef<HTMLElement>(null);
  const toggle = () => {
    setOpen((value) => {
      const next = !value;
      if (next && !localStorage.getItem("degen-theme-tip")) setTip(true);
      return next;
    });
  };
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const box = windowRef.current?.getBoundingClientRect();
    if (!box) return;
    const dx = event.clientX - box.left,
      dy = event.clientY - box.top;
    const move = (e: PointerEvent) =>
      setRect({
        left: Math.max(0, Math.min(innerWidth - box.width, e.clientX - dx)),
        top: Math.max(0, Math.min(innerHeight - 50, e.clientY - dy)),
        width: box.width,
      });
    const up = (e: PointerEvent) => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      const x = e.clientX - dx,
        y = e.clientY - dy;
      if (y < 35)
        setRect({
          left: 8,
          top: 8,
          width: innerWidth - 16,
          height: innerHeight - 16,
        });
      else if (x < 35)
        setRect({
          left: 8,
          top: 80,
          width: Math.max(320, innerWidth / 2 - 12),
          height: innerHeight - 88,
        });
      else if (x + box.width > innerWidth - 35)
        setRect({
          left: innerWidth / 2 + 4,
          top: 80,
          width: innerWidth / 2 - 12,
          height: innerHeight - 88,
        });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const style = rect
    ? {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: "auto",
      }
    : undefined;
  return (
    <>
      <button className="pill-button" onClick={toggle}>
        ☯ Theme
      </button>
      {open && (
        <>
          <section
            ref={windowRef}
            style={style}
            className={`theme-window ${peek ? "peek" : ""}`}
            role="dialog"
            aria-label="Theme picker"
          >
            <header className="theme-window-head" onPointerDown={startDrag}>
              <strong>☯ Theme</strong>
              <div>
                <button onClick={() => setPeek((v) => !v)}>⊙ Peek</button>
                <button onClick={() => setRect(null)}>—</button>
                <button
                  aria-label="Close theme picker"
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              </div>
            </header>
            <div className="theme-window-tabs">
              <button
                className={tab === "themes" ? "active" : ""}
                onClick={() => setTab("themes")}
              >
                ☯ Themes
              </button>
              <button
                className={tab === "custom" ? "active" : ""}
                onClick={() => setTab("custom")}
              >
                ✎ Customize
              </button>
            </div>
            <div className="theme-window-body">
              {tab === "themes" ? (
                <>
                  <h3>Default Themes</h3>
                  <div className="theme-grid">
                    {(
                      Object.entries(THEMES) as Array<
                        [ThemeName, (typeof THEMES)[ThemeName]]
                      >
                    ).map(([name, colors]) => (
                      <button
                        key={name}
                        className={`theme-swatch ${theme === name ? "active" : ""}`}
                        style={{ background: colors.bg, color: colors.fg }}
                        onClick={() => {
                          localStorage.removeItem("degen-react-custom");
                          applyTheme(name);
                          setCustom({ ...colors });
                          setTheme(name);
                        }}
                      >
                        <span>
                          <i style={{ background: colors.bg }} />
                          <i style={{ background: colors.fg }} />
                          <i style={{ background: colors.accent }} />
                        </span>
                        {name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <h3>Customize Theme</h3>
                  <div className="theme-custom-grid">
                    {(
                      [
                        ["bg", "Background"],
                        ["fg", "Text"],
                        ["panel", "Panels"],
                        ["border", "Borders"],
                        ["accent", "Accent"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          type="color"
                          value={custom[key]}
                          onChange={(event) =>
                            setCustomColor(key, event.target.value)
                          }
                        />
                        <code>{custom[key]}</code>
                      </label>
                    ))}
                  </div>
                  <button className="theme-reset" onClick={resetCustom}>
                    Reset to {theme}
                  </button>
                </>
              )}
            </div>
          </section>
          {tip && (
            <aside className="theme-pro-tip">
              <div className="snap-demo">
                <i />
                <b>➤</b>
              </div>
              <p>
                <strong>Pro tip:</strong> drag the window&apos;s title bar to a
                screen edge to snap it. Drag to the top for fullscreen.
              </p>
              <button
                onClick={() => {
                  localStorage.setItem("degen-theme-tip", "seen");
                  setTip(false);
                }}
              >
                Got it
              </button>
            </aside>
          )}
        </>
      )}
    </>
  );
}
