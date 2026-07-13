export type ThemeName = keyof typeof THEMES;

export const THEMES = {
  original: {
    bg: "#282c34",
    fg: "#9cdef2",
    panel: "#111111",
    border: "#355a66",
    accent: "#e06c75",
    effect: "synapse",
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
    effect: "embers",
  },
  terminal: {
    bg: "#000000",
    fg: "#00ff41",
    panel: "#0a0a0a",
    border: "#003b00",
    accent: "#00ff41",
    effect: "flow",
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
    effect: "petals",
  },
  GPT: {
    bg: "#212121",
    fg: "#ececec",
    panel: "#171717",
    border: "#424242",
    accent: "#949494",
    effect: "flow",
  },
  claude: {
    bg: "#262624",
    fg: "#f5f4f0",
    panel: "#30302e",
    border: "#4a4a47",
    accent: "#c6613f",
    effect: "embers",
  },
  cute: {
    bg: "#fff0f5",
    fg: "#d4608a",
    panel: "#fff8fa",
    border: "#f0c0d0",
    accent: "#ff6b9d",
    effect: "sparkles",
  },
} as const;

export function applyTheme(name: ThemeName) {
  const theme = THEMES[name];
  const root = document.documentElement;
  root.style.setProperty("--bg", theme.bg);
  root.style.setProperty("--fg", theme.fg);
  root.style.setProperty("--panel", theme.panel);
  root.style.setProperty("--border", theme.border);
  root.style.setProperty("--accent", theme.accent);
  document.body.dataset.effect = theme.effect;
  localStorage.setItem("degen-react-theme", name);
}
