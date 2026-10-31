import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { applyTheme, applyThemeColors, isThemeName, THEME_COLOR_KEYS, THEMES, NEW_THEME_NAMES, type ThemeColors, type ThemeName } from "../themes/themes";
import {
  applyBackground,
  BACKGROUND_PATTERNS,
  backgroundDefaults,
  readBackground,
  type BackgroundSettings,
} from "../themes/backgroundEffects";

// Keep the header, tabs and some scrollable content on screen while dragging.
export const fitThemeWindowTop = (top: number, viewportHeight: number) =>
  Math.max(8, Math.min(top, viewportHeight - Math.min(240, viewportHeight - 16) - 8));

const readPreference = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const savePreference = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* Changes still apply without storage. */ }
};
const removePreference = (key: string) => {
  try { localStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
};

const readSavedCustomColors = (): Partial<ThemeColors> | null => {
  try {
    const saved = JSON.parse(
      readPreference("degen-react-custom") || "null",
    ) as unknown;
    if (!saved) return null;
    if (typeof saved === "object" && !Array.isArray(saved)) {
      const colors = Object.fromEntries(THEME_COLOR_KEYS.flatMap((key) => {
        const value = (saved as Record<string, unknown>)[key];
        return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? [[key, value]] : [];
      })) as Partial<ThemeColors>;
      if (Object.keys(colors).length) return colors;
    }
  } catch { /* An invalid saved customization falls back to the preset. */ }
  removePreference("degen-react-custom");
  return null;
};

const readCustomColors = (theme: ThemeName): ThemeColors => ({
  ...THEMES[theme], ...readSavedCustomColors(),
});

const themeCollections: { title: string; names: readonly ThemeName[] }[] = [
  { title: "New colors", names: NEW_THEME_NAMES },
  { title: "Classic themes", names: (Object.keys(THEMES) as ThemeName[]).filter(name => !(NEW_THEME_NAMES as readonly ThemeName[]).includes(name)) },
];

export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = readPreference("degen-react-theme");
    return isThemeName(saved) ? saved : "original";
  });
  useLayoutEffect(() => {
    applyTheme(theme);
    applyThemeColors(readCustomColors(theme));
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
    [tab, setTab] = useState<"themes" | "custom">("themes");
  const [custom, setCustom] = useState(() => readCustomColors(theme));
  const [customApplied, setCustomApplied] = useState(
    () => Boolean(readSavedCustomColors()),
  );
  const [background, setBackground] = useState<BackgroundSettings>(() =>
    readBackground(theme),
  );
  useEffect(() => {
    setCustom(readCustomColors(theme));
    setCustomApplied(Boolean(readSavedCustomColors()));
    setBackground(readBackground(theme));
  }, [theme]);
  const setCustomColor = (
    key: "bg" | "fg" | "panel" | "border" | "accent",
    value: string,
  ) => {
    setCustom((current) => ({ ...current, [key]: value }));
  };
  const applyCustomTheme = () => {
    applyThemeColors(custom);
    savePreference(
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
    applyBackground(background, false);
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerId = useId();
  const dragCleanup = useRef<(() => void) | null>(null);
  const close = () => {
    dragCleanup.current?.();
    setOpen(false);
    setPeek(false);
    triggerRef.current?.focus();
  };
  useEffect(() => {
    if (open) windowRef.current?.focus();
  }, [open]);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => {
    const fitWindow = () => setRect(current => {
      if (!current) return current;
      const width = Math.min(current.width ?? 540, innerWidth - 16);
      return { ...current, width, left: Math.max(8, Math.min(current.left, innerWidth - width - 8)), top: fitThemeWindowTop(current.top, innerHeight) };
    });
    addEventListener("resize", fitWindow);
    return () => removeEventListener("resize", fitWindow);
  }, []);
  const toggle = () => {
    if (open) { close(); return; }
    setOpen(true);
  };
  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const box = windowRef.current?.getBoundingClientRect();
    if (!box) return;
    const dx = event.clientX - box.left,
      dy = event.clientY - box.top;
    const move = (e: PointerEvent) =>
      setRect({
        left: Math.max(0, Math.min(innerWidth - box.width, e.clientX - dx)),
        top: fitThemeWindowTop(e.clientY - dy, innerHeight),
        width: box.width,
      });
    const up = (e: PointerEvent) => {
      dragCleanup.current?.();
      const x = e.clientX - dx,
        y = e.clientY - dy;
      if (y < 35 || (innerWidth < 700 && (x < 35 || x + box.width > innerWidth - 35)))
        setRect({
          left: 8,
          top: 8,
          width: innerWidth - 16,
          height: innerHeight - 16,
        });
      else if (x < 35)
        setRect({
          left: 8,
          top: fitThemeWindowTop(80, innerHeight),
          width: Math.max(320, innerWidth / 2 - 12),
          height: innerHeight - 88,
        });
      else if (x + box.width > innerWidth - 35)
        setRect({
          left: innerWidth / 2 + 4,
          top: fitThemeWindowTop(80, innerHeight),
          width: innerWidth / 2 - 12,
          height: innerHeight - 88,
        });
    };
    dragCleanup.current?.();
    dragCleanup.current = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      dragCleanup.current = null;
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
        maxHeight: `calc(100dvh - ${rect.top + 12}px)`,
        right: "auto",
      }
    : undefined;
  return (
    <>
      <button ref={triggerRef} className="pill-button" onClick={toggle} aria-expanded={open} aria-controls={pickerId}>
        Theme
      </button>
      {open && (
        <>
          <section
            id={pickerId}
            ref={windowRef}
            style={style}
            className={`theme-window ${peek ? "peek" : ""}`}
            role="dialog"
            aria-label="Theme picker"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
            }}
          >
            <header className="theme-window-head" onPointerDown={startDrag}>
              <strong>Theme</strong>
              <div>
                <button aria-pressed={peek} onClick={() => setPeek((v) => !v)}>Preview</button>
                <button aria-label="Restore theme window" onClick={() => setRect(null)}>Reset</button>
                <button
                  aria-label="Close theme picker"
                  onClick={close}
                >
                  ×
                </button>
              </div>
            </header>
            <div className="theme-window-tabs">
              <button
                className={tab === "themes" ? "active" : ""}
                aria-pressed={tab === "themes"}
                onClick={() => setTab("themes")}
              >
                Themes
              </button>
              <button
                className={tab === "custom" ? "active" : ""}
                aria-pressed={tab === "custom"}
                onClick={() => setTab("custom")}
              >
                Customize
              </button>
            </div>
            <div className="theme-window-body" role="region" aria-label="Theme settings" tabIndex={0}>
              {tab === "themes" ? (
                <>
                  {themeCollections.map(collection => <section className="theme-collection" key={collection.title} aria-label={collection.title}>
                  <h3>{collection.title}</h3>
                  <div className="theme-grid">
                    {collection.names.map(name => {
                      const colors = THEMES[name];
                      return (
                      <button
                        key={name}
                        aria-pressed={!customApplied && theme === name}
                        className={`theme-swatch ${
                          !customApplied && theme === name ? "active" : ""
                        }`}
                        style={{ background: colors.bg, color: colors.fg }}
                        onClick={() => {
                          removePreference("degen-react-custom");
                          removePreference("degen-react-background");
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
                        {name === "GPT" ? name : name.charAt(0).toUpperCase() + name.slice(1)}
                      </button>
                    ); })}
                  </div>
                  </section>)}
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
        </>
      )}
    </>
  );
}
