import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { applyTheme, THEMES, type ThemeName } from "../themes/themes";
import {
  applyBackground,
  BACKGROUND_PATTERNS,
  backgroundDefaults,
  readBackground,
  type BackgroundSettings,
} from "../themes/backgroundEffects";

const readCustomColors = (theme: ThemeName) => {
  const base = { ...THEMES[theme] };
  try {
    const saved = JSON.parse(
      localStorage.getItem("degen-react-custom") || "null",
    ) as Partial<typeof base> | null;
    return saved ? { ...base, ...saved } : base;
  } catch {
    localStorage.removeItem("degen-react-custom");
    return base;
  }
};

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
    applyBackground(readBackground(theme), false);
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
  const [custom, setCustom] = useState(() => readCustomColors(theme));
  const [customApplied, setCustomApplied] = useState(
    () => Boolean(localStorage.getItem("degen-react-custom")),
  );
  const [background, setBackground] = useState<BackgroundSettings>(() =>
    readBackground(theme),
  );
  useEffect(() => {
    setCustom(readCustomColors(theme));
    setBackground(readBackground(theme));
  }, [theme]);
  const setCustomColor = (
    key: "bg" | "fg" | "panel" | "border" | "accent",
    value: string,
  ) => {
    setCustom((current) => ({ ...current, [key]: value }));
  };
  const applyCustomTheme = () => {
    (["bg", "fg", "panel", "border", "accent"] as const).forEach((key) =>
      document.documentElement.style.setProperty(`--${key}`, custom[key]),
    );
    localStorage.setItem(
      "degen-react-custom",
      JSON.stringify({
        bg: custom.bg,
        fg: custom.fg,
        panel: custom.panel,
        border: custom.border,
        accent: custom.accent,
      }),
    );
    setCustomApplied(true);
  };
  const updateBackground = (patch: Partial<BackgroundSettings>) => {
    const next = { ...background, ...patch };
    setBackground(next);
    applyBackground(next);
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
                        className={`theme-swatch ${
                          !customApplied && theme === name ? "active" : ""
                        }`}
                        style={{ background: colors.bg, color: colors.fg }}
                        onClick={() => {
                          localStorage.removeItem("degen-react-custom");
                          localStorage.removeItem("degen-react-background");
                          applyTheme(name);
                          setCustom({ ...colors });
                          const nextBackground = backgroundDefaults(name);
                          setBackground(nextBackground);
                          applyBackground(nextBackground, false);
                          setCustomApplied(false);
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
                  <h3>Colors</h3>
                  <div className="theme-custom-grid">
                    {(
                      [
                        ["bg", "Background"],
                        ["fg", "Text"],
                        ["panel", "Panel"],
                        ["border", "Border"],
                        ["accent", "Accent"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          type="color"
                          aria-label={label}
                          value={custom[key]}
                          onChange={(event) =>
                            setCustomColor(key, event.target.value)
                          }
                        />
                        <code>{custom[key]}</code>
                      </label>
                    ))}
                  </div>
                  <button className="theme-apply" onClick={applyCustomTheme}>
                    Apply Custom Theme
                  </button>
                  <div className="theme-background-settings">
                    <h3>Background</h3>
                    <label className="theme-select-row">
                      <span>Animation</span>
                      <select
                        aria-label="Animation"
                        value={background.pattern}
                        onChange={(event) =>
                          updateBackground({
                            pattern: event.target
                              .value as BackgroundSettings["pattern"],
                          })
                        }
                      >
                        {BACKGROUND_PATTERNS.map((effect) => (
                          <option key={effect}>{effect}</option>
                        ))}
                      </select>
                    </label>
                    <label className="theme-select-row">
                      <span>Effect color</span>
                      <input
                        aria-label="Effect color"
                        type="color"
                        value={background.effectColor || custom.fg}
                        onChange={(event) =>
                          updateBackground({
                            effectColor: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="theme-range-row">
                      <span>Intensity</span>
                      <input
                        aria-label="Intensity"
                        type="range"
                        min="0"
                        max="100"
                        value={Math.round(background.intensity * 100)}
                        onChange={(event) =>
                          updateBackground({
                            intensity: Number(event.target.value) / 100,
                          })
                        }
                      />
                    </label>
                    <label className="theme-range-row">
                      <span>Size</span>
                      <input
                        aria-label="Size"
                        type="range"
                        min="30"
                        max="250"
                        value={Math.round(background.size * 100)}
                        onChange={(event) =>
                          updateBackground({
                            size: Number(event.target.value) / 100,
                          })
                        }
                      />
                    </label>
                    <label className="theme-check-row">
                      <span>Frosted glass</span>
                      <input
                        aria-label="Frosted glass"
                        type="checkbox"
                        checked={background.frosted}
                        onChange={(event) =>
                          updateBackground({
                            frosted: event.target.checked,
                          })
                        }
                      />
                    </label>
                  </div>
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
