export type ThemeName = keyof typeof THEMES;

export const THEME_COLOR_KEYS = ["bg", "fg", "panel", "border", "accent"] as const;
export type ThemeColors = Record<(typeof THEME_COLOR_KEYS)[number], string>;

export const isThemeName = (name: unknown): name is ThemeName =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(THEMES, name);

export function applyThemeColors(colors: ThemeColors) {
  THEME_COLOR_KEYS.forEach((key) =>
    document.documentElement.style.setProperty(`--${key}`, colors[key]),
  );
}

export const THEMES = {
  oink: {
    bg: "#241a20",
    fg: "#f2cfde",
    panel: "#171013",
    border: "#5c3a4b",
    accent: "#ff6b9d",
    effect: "none",
  },
  original: {
    bg: "#282c34",
    fg: "#9cdef2",
    panel: "#111111",
    border: "#355a66",
    accent: "#e06c75",
    effect: "none",
  },
  light: {
    bg: "#f0ebe3",
    fg: "#5a5248",
    panel: "#faf6f0",
    border: "#d4cdc2",
    accent: "#c47d5a",
    effect: "dots",
  },
  midnight: {
    bg: "#0d1117",
    fg: "#c9d1d9",
    panel: "#161b22",
    border: "#30363d",
    accent: "#f85149",
    effect: "rain",
  },
  paper: {
    bg: "#faf8f5",
    fg: "#3b3836",
    panel: "#ffffff",
    border: "#d5d0c8",
    accent: "#c5ac4a",
    effect: "dots",
  },
  cyberpunk: {
    bg: "#0a0a0f",
    fg: "#0ff0fc",
    panel: "#12101a",
    border: "#9b30ff",
    accent: "#e040fb",
    effect: "synapse",
  },
  retrowave: {
    bg: "#1a1a2e",
    fg: "#e94560",
    panel: "#16213e",
    border: "#533483",
    accent: "#e94560",
    effect: "embers",
  },
  forest: {
    bg: "#1b2a1b",
    fg: "#a8d5a2",
    panel: "#142414",
    border: "#3d6b3d",
    accent: "#7cb871",
    effect: "petals",
  },
  ocean: {
    bg: "#0b1a2c",
    fg: "#64d2ff",
    panel: "#091422",
    border: "#1e5074",
    accent: "#4facfe",
    effect: "constellations",
  },
  ume: {
    bg: "#2b1b2e",
    fg: "#f5c2e7",
    panel: "#1e1420",
    border: "#6c4675",
    accent: "#f5a0c0",
    effect: "petals",
  },
  copper: {
    bg: "#1c1410",
    fg: "#e8c39e",
    panel: "#140f0a",
    border: "#7a5533",
    accent: "#d4764e",
    effect: "none",
  },
  terminal: {
    bg: "#000000",
    fg: "#00ff41",
    panel: "#0a0a0a",
    border: "#003b00",
    accent: "#00ff41",
    effect: "perlin-flow",
  },
  organs: {
    bg: "#0a0406",
    fg: "#efe1c8",
    panel: "#15080a",
    border: "#3a1519",
    accent: "#c83240",
    effect: "rain",
  },
  lavender: {
    bg: "#f3eef8",
    fg: "#3d3551",
    panel: "#faf7ff",
    border: "#cec3de",
    accent: "#9b6dcc",
    effect: "none",
  },
  GPT: {
    bg: "#212121",
    fg: "#ececec",
    panel: "#171717",
    border: "#424242",
    accent: "#949494",
    effect: "none",
  },
  claude: {
    bg: "#262624",
    fg: "#f5f4f0",
    panel: "#30302e",
    border: "#4a4a47",
    accent: "#c6613f",
    effect: "none",
  },
  cute: {
    bg: "#fff0f5",
    fg: "#d4608a",
    panel: "#fff8fa",
    border: "#f0c0d0",
    accent: "#ff6b9d",
    effect: "sparkles",
  },
  aurora: {
    bg: "#071a18",
    fg: "#e5fff5",
    panel: "#0b2420",
    border: "#2f6d5c",
    accent: "#60f0b6",
    effect: "none",
  },
  amethyst: {
    bg: "#171127",
    fg: "#f3efff",
    panel: "#211832",
    border: "#665080",
    accent: "#bea1ff",
    effect: "none",
  },
  sunset: {
    bg: "#251714",
    fg: "#fff0e8",
    panel: "#301f1b",
    border: "#895747",
    accent: "#ffa58e",
    effect: "none",
  },
  gold: {
    bg: "#18150d",
    fg: "#fff6df",
    panel: "#221d12",
    border: "#796638",
    accent: "#ffd36e",
    effect: "none",
  },
  glacier: {
    bg: "#091629",
    fg: "#eef5ff",
    panel: "#10213a",
    border: "#365b89",
    accent: "#80b6ff",
    effect: "none",
  },
  matcha: {
    bg: "#151c10",
    fg: "#f0f7e8",
    panel: "#1b2516",
    border: "#566d3c",
    accent: "#bce18a",
    effect: "none",
  },
  cherry: {
    bg: "#231219",
    fg: "#ffe9f1",
    panel: "#301922",
    border: "#7c4357",
    accent: "#ff96b7",
    effect: "none",
  },
  slate: {
    bg: "#111820",
    fg: "#edf2f7",
    panel: "#19232e",
    border: "#4d6177",
    accent: "#b8d2ed",
    effect: "none",
  },
  obsidian: {
    bg: "#09090f",
    fg: "#f4f4f5",
    panel: "#131318",
    border: "#34333d",
    accent: "#f5b331",
    effect: "starlight",
  },
} as const;

export const NEW_THEME_NAMES = ["obsidian", "aurora", "amethyst", "sunset", "gold", "glacier", "matcha", "cherry", "slate"] as const satisfies readonly ThemeName[];

export function applyTheme(name: ThemeName) {
  const theme = THEMES[name];
  document.documentElement.dataset.theme = name;
  applyThemeColors(theme);
  try {
    localStorage.setItem("degen-react-theme", name);
  } catch { /* Theme changes still work when browser storage is unavailable. */ }
}
