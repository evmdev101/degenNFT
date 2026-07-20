import { THEMES, type ThemeName } from "./themes";

export const BACKGROUND_PATTERNS = [
  "none",
  "dots",
  "synapse",
  "rain",
  "constellations",
  "perlin-flow",
  "petals",
  "sparkles",
  "embers",
] as const;

export type BackgroundPattern = (typeof BACKGROUND_PATTERNS)[number];

export type BackgroundSettings = {
  pattern: BackgroundPattern;
  effectColor: string;
  intensity: number;
  size: number;
  frosted: boolean;
};

const PATTERN_DEFAULTS: Partial<
  Record<ThemeName, Partial<BackgroundSettings>>
> = {
  light: { pattern: "dots" },
  midnight: { pattern: "rain", effectColor: "#ffffff", intensity: 0.5 },
  paper: { pattern: "dots" },
  cyberpunk: { pattern: "synapse" },
  retrowave: { pattern: "embers" },
  forest: { pattern: "petals" },
  ocean: { pattern: "constellations" },
  terminal: { pattern: "perlin-flow", intensity: 0.8 },
  organs: { pattern: "rain", effectColor: "#451616", intensity: 0.65 },
  ume: { pattern: "petals", effectColor: "#f5a0c0" },
  lavender: { frosted: true },
  cute: { pattern: "sparkles", effectColor: "#ff8cb8" },
};

const PATTERN_CLASSES = BACKGROUND_PATTERNS.filter(
  (pattern) => pattern !== "none",
).map((pattern) => `bg-pattern-${pattern}`);

const CANVAS_IDS = [
  "synapse-canvas",
  "rain-canvas",
  "constellations-canvas",
  "perlin-flow-canvas",
  "petals-canvas",
  "sparkles-canvas",
  "embers-canvas",
];

export function backgroundDefaults(theme: ThemeName): BackgroundSettings {
  return {
    pattern: "none",
    effectColor: "",
    intensity: 1,
    size: 1,
    frosted: false,
    ...PATTERN_DEFAULTS[theme],
  };
}

export function readBackground(theme: ThemeName): BackgroundSettings {
  try {
    const saved = JSON.parse(
      localStorage.getItem("degen-react-background") || "null",
    ) as
      | (Partial<BackgroundSettings> & {
          animation?: string;
        })
      | null;
    if (!saved) return backgroundDefaults(theme);

    const legacyPattern = saved.pattern ?? saved.animation;
    const pattern = BACKGROUND_PATTERNS.includes(
      legacyPattern as BackgroundPattern,
    )
      ? (legacyPattern as BackgroundPattern)
      : legacyPattern === "flow"
        ? "perlin-flow"
        : backgroundDefaults(theme).pattern;
    const intensity =
      typeof saved.intensity === "number"
        ? saved.intensity > 1
          ? saved.intensity / 100
          : saved.intensity
        : 1;
    const size =
      typeof saved.size === "number"
        ? saved.size > 3
          ? saved.size / 100
          : saved.size
        : 1;

    return {
      ...backgroundDefaults(theme),
      ...saved,
      pattern,
      intensity: Math.max(0, Math.min(1, intensity)),
      size: Math.max(0.2, Math.min(3, size)),
    };
  } catch {
    localStorage.removeItem("degen-react-background");
    return backgroundDefaults(theme);
  }
}

export function applyBackground(
  settings: BackgroundSettings,
  persist = true,
) {
  const root = document.documentElement;
  root.style.setProperty("--bg-effect-color", settings.effectColor || "");
  root.style.setProperty(
    "--bg-effect-intensity",
    String(Math.max(0, Math.min(1, Number(settings.intensity)))),
  );
  root.style.setProperty(
    "--bg-effect-size",
    String(Math.max(0.2, Math.min(3, Number(settings.size)))),
  );
  document.body.classList.toggle("theme-frosted", settings.frosted);
  applyPattern(settings.pattern);
  if (persist)
    localStorage.setItem(
      "degen-react-background",
      JSON.stringify(settings),
    );
}

function applyPattern(pattern: BackgroundPattern) {
  delete document.body.dataset.effect;
  delete document.body.dataset.frosted;
  document.body.classList.remove(...PATTERN_CLASSES);
  document
    .querySelectorAll(CANVAS_IDS.map((id) => `#${id}`).join(", "))
    .forEach((canvas) => canvas.remove());
  if (pattern !== "none")
    document.body.classList.add(`bg-pattern-${pattern}`);
  EFFECT_STARTERS[pattern]?.();
}

function effectColor(fallback = "#9cdef2") {
  const styles = getComputedStyle(document.documentElement);
  return (
    styles.getPropertyValue("--bg-effect-color").trim() ||
    styles.getPropertyValue("--fg").trim() ||
    fallback
  );
}

function effectSize() {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--bg-effect-size",
    ),
  );
  return Number.isNaN(value) ? 1 : value;
}

function createEffectCanvas(id: string) {
  const canvas = document.createElement("canvas");
  canvas.id = id;
  canvas.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;";
  document.body.prepend(canvas);
  return canvas;
}

function startSynapse() {
  if (document.getElementById("synapse-canvas")) return;
  const canvas = createEffectCanvas("synapse-canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const grid = 24;
  const maxParticles = 20;
  const minSpeed = 2;
  const maxSpeed = 22;
  const tail = 12;
  let width = 0;
  let height = 0;
  let columns = 0;
  let rows = 0;
  const particles: Array<{
    x: number;
    y: number;
    dx: number;
    dy: number;
  }> = [];

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    columns = Math.ceil(width / grid);
    rows = Math.ceil(height / grid);
  };
  resize();
  window.addEventListener("resize", resize);

  const addParticle = () => {
    const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
    if (Math.random() > 0.5) {
      const row = Math.floor(Math.random() * (rows + 1));
      particles.push({ x: -tail, y: row * grid, dx: speed, dy: 0 });
    } else {
      const column = Math.floor(Math.random() * (columns + 1));
      particles.push({ x: column * grid, y: -tail, dx: 0, dy: speed });
    }
  };

  const draw = () => {
    if (!document.body.classList.contains("bg-pattern-synapse")) {
      window.removeEventListener("resize", resize);
      canvas.remove();
      return;
    }
    requestAnimationFrame(draw);
    context.clearRect(0, 0, width, height);
    const color = effectColor();
    if (particles.length < maxParticles && Math.random() < 0.12)
      addParticle();
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.x += particle.dx;
      particle.y += particle.dy;
      if (particle.x > width + tail || particle.y > height + tail) {
        particles.splice(index, 1);
        continue;
      }
      const startX = particle.x - (particle.dx > 0 ? tail : 0);
      const startY = particle.y - (particle.dy > 0 ? tail : 0);
      const gradient = context.createLinearGradient(
        startX,
        startY,
        particle.x,
        particle.y,
      );
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(1, color);
      context.strokeStyle = gradient;
      context.globalAlpha = 0.35;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(particle.x, particle.y);
      context.stroke();
      context.globalAlpha = 0.55;
      context.fillStyle = color;
      context.beginPath();
      context.arc(particle.x, particle.y, 1.2, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  };
  draw();
}

function startRain() {
  if (document.getElementById("rain-canvas")) return;
  const canvas = createEffectCanvas("rain-canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  const drops: Array<{
    x: number;
    y: number;
    len: number;
    speed: number;
    alpha: number;
  }> = [];
  const maxDrops = 130;

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const addDrop = () => {
    const len = 20 + Math.random() * 40;
    drops.push({
      x: Math.random() * width,
      y: -len,
      len,
      speed: 4 + Math.random() * 8,
      alpha: 0.32 + Math.random() * 0.28,
    });
  };

  const draw = () => {
    if (!document.body.classList.contains("bg-pattern-rain")) {
      window.removeEventListener("resize", resize);
      canvas.remove();
      return;
    }
    requestAnimationFrame(draw);
    context.clearRect(0, 0, width, height);
    const color = effectColor();
    const rawIntensity = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--bg-effect-intensity",
      ),
    );
    const intensity = Number.isNaN(rawIntensity) ? 1 : rawIntensity;
    const speedScale = 0.35 + intensity * 0.65;
    const size = effectSize();
    if (drops.length < maxDrops * intensity && Math.random() < 0.6 * intensity)
      addDrop();
    for (let index = drops.length - 1; index >= 0; index -= 1) {
      const drop = drops[index];
      drop.y += drop.speed * speedScale;
      if (drop.y > height + drop.len * size) {
        drops.splice(index, 1);
        continue;
      }
      const length = drop.len * size;
      const gradient = context.createLinearGradient(
        drop.x,
        drop.y - length,
        drop.x,
        drop.y,
      );
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(1, color);
      context.strokeStyle = gradient;
      context.globalAlpha = drop.alpha;
      context.lineWidth = 1.3 * Math.min(2, Math.max(0.6, size));
      context.beginPath();
      context.moveTo(drop.x, drop.y - length);
      context.lineTo(drop.x, drop.y);
      context.stroke();
    }
    context.globalAlpha = 1;
  };
  draw();
}

function startConstellations() {
  if (document.getElementById("constellations-canvas")) return;
  const canvas = createEffectCanvas("constellations-canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  const pointCount = 50;
  const linkDistance = 120;
  let points: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number;
    phase: number;
  }> = [];

  const seed = () => {
    points = Array.from({ length: pointCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      radius: 0.8 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
    }));
  };
  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (points.length === 0) seed();
  };
  resize();
  const handleResize = () => {
    resize();
    seed();
  };
  window.addEventListener("resize", handleResize);

  let time = 0;
  const draw = () => {
    if (!document.body.classList.contains("bg-pattern-constellations")) {
      window.removeEventListener("resize", handleResize);
      canvas.remove();
      return;
    }
    requestAnimationFrame(draw);
    time += 0.01;
    context.clearRect(0, 0, width, height);
    const color = effectColor();
    points.forEach((point) => {
      point.x += point.vx;
      point.y += point.vy;
      if (point.x < 0) point.x = width;
      if (point.x > width) point.x = 0;
      if (point.y < 0) point.y = height;
      if (point.y > height) point.y = 0;
    });
    context.strokeStyle = color;
    context.lineWidth = 0.5;
    for (let start = 0; start < points.length; start += 1) {
      for (let end = start + 1; end < points.length; end += 1) {
        const dx = points[start].x - points[end].x;
        const dy = points[start].y - points[end].y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < linkDistance) {
          context.globalAlpha = (1 - distance / linkDistance) * 0.15;
          context.beginPath();
          context.moveTo(points[start].x, points[start].y);
          context.lineTo(points[end].x, points[end].y);
          context.stroke();
        }
      }
    }
    context.fillStyle = color;
    points.forEach((point) => {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2 + point.phase);
      context.globalAlpha = 0.15 + pulse * 0.25;
      context.beginPath();
      context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fill();
    });
    context.globalAlpha = 1;
  };
  draw();
}

function hashNoise(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function smoothNoise(x: number, y: number) {
  const floorX = Math.floor(x);
  const floorY = Math.floor(y);
  const offsetX = x - floorX;
  const offsetY = y - floorY;
  const topLeft = hashNoise(floorX, floorY);
  const topRight = hashNoise(floorX + 1, floorY);
  const bottomLeft = hashNoise(floorX, floorY + 1);
  const bottomRight = hashNoise(floorX + 1, floorY + 1);
  const smoothX = offsetX * offsetX * (3 - 2 * offsetX);
  const smoothY = offsetY * offsetY * (3 - 2 * offsetY);
  return (
    topLeft +
    (topRight - topLeft) * smoothX +
    (bottomLeft - topLeft) * smoothY +
    (topLeft - topRight - bottomLeft + bottomRight) * smoothX * smoothY
  );
}

function startPerlinFlow() {
  if (document.getElementById("perlin-flow-canvas")) return;
  const canvas = createEffectCanvas("perlin-flow-canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  let time = 0;
  const particles: Array<{ x: number; y: number; life: number }> = [];

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (particles.length === 0)
      for (let index = 0; index < 200; index += 1)
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          life: Math.random(),
        });
  };
  resize();
  window.addEventListener("resize", resize);
  let lastBackground = "";
  let fadeColor = "";
  const getFadeColor = () => {
    const background =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim() || "#282c34";
    if (background !== lastBackground) {
      lastBackground = background;
      const hex = background.replace("#", "");
      fadeColor = `rgba(${Number.parseInt(hex.slice(0, 2), 16)},${Number.parseInt(hex.slice(2, 4), 16)},${Number.parseInt(hex.slice(4, 6), 16)},0.02)`;
    }
    return fadeColor;
  };

  const draw = () => {
    if (!document.body.classList.contains("bg-pattern-perlin-flow")) {
      window.removeEventListener("resize", resize);
      canvas.remove();
      return;
    }
    requestAnimationFrame(draw);
    context.fillStyle = getFadeColor();
    context.fillRect(0, 0, width, height);
    const color = effectColor();
    particles.forEach((particle) => {
      const angle =
        smoothNoise(
          particle.x * 0.004 + time * 0.0008,
          particle.y * 0.004 + 100,
        ) *
        Math.PI *
        6;
      const speed =
        1 + smoothNoise(particle.x * 0.003, particle.y * 0.003 + 50) * 1.5;
      particle.x += Math.cos(angle) * speed;
      particle.y += Math.sin(angle) * speed;
      particle.life -= 0.001;
      if (
        particle.life <= 0 ||
        particle.x < 0 ||
        particle.x > width ||
        particle.y < 0 ||
        particle.y > height
      ) {
        particle.x = Math.random() * width;
        particle.y = Math.random() * height;
        particle.life = 1;
      }
      context.beginPath();
      context.arc(particle.x, particle.y, 1, 0, Math.PI * 2);
      context.fillStyle = color;
      context.globalAlpha = particle.life * 0.15;
      context.fill();
    });
    context.globalAlpha = 1;
    time += 1;
  };
  draw();
}

function startPetals() {
  if (document.getElementById("petals-canvas")) return;
  const canvas = createEffectCanvas("petals-canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  const petals: Array<{
    x: number;
    y: number;
    size: number;
    rotation: number;
    rotationVelocity: number;
    velocityY: number;
    drift: number;
    driftSpeed: number;
    wobble: number;
  }> = [];
  const createPetal = () => ({
    x: Math.random() * width,
    y: -10 - Math.random() * 40,
    size: 3 + Math.random() * 5,
    rotation: Math.random() * Math.PI * 2,
    rotationVelocity: (Math.random() - 0.5) * 0.03,
    velocityY: 0.3 + Math.random() * 0.6,
    drift: Math.random() * Math.PI * 2,
    driftSpeed: 0.008 + Math.random() * 0.012,
    wobble: 0.3 + Math.random() * 0.8,
  });
  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (petals.length === 0)
      for (let index = 0; index < 30; index += 1) {
        const petal = createPetal();
        petal.y = Math.random() * height;
        petals.push(petal);
      }
  };
  resize();
  window.addEventListener("resize", resize);

  const draw = () => {
    if (!document.body.classList.contains("bg-pattern-petals")) {
      window.removeEventListener("resize", resize);
      canvas.remove();
      return;
    }
    requestAnimationFrame(draw);
    context.clearRect(0, 0, width, height);
    const color = effectColor();
    const size = effectSize();
    petals.forEach((petal) => {
      petal.y += petal.velocityY;
      petal.rotation += petal.rotationVelocity;
      petal.drift += petal.driftSpeed;
      petal.x += Math.sin(petal.drift) * petal.wobble;
      if (petal.y > height + 15) Object.assign(petal, createPetal());
      context.save();
      context.translate(petal.x, petal.y);
      context.rotate(petal.rotation);
      context.globalAlpha = 0.2;
      context.fillStyle = color;
      context.beginPath();
      context.ellipse(
        -petal.size * 0.2 * size,
        0,
        petal.size * 0.6 * size,
        petal.size * 0.3 * size,
        0.3,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.globalAlpha = 0.15;
      context.beginPath();
      context.ellipse(
        petal.size * 0.2 * size,
        0,
        petal.size * 0.6 * size,
        petal.size * 0.3 * size,
        -0.3,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.restore();
    });
    context.globalAlpha = 1;
  };
  draw();
}

function startSparkles() {
  if (document.getElementById("sparkles-canvas")) return;
  const canvas = createEffectCanvas("sparkles-canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  const sparkles: Array<{
    x: number;
    y: number;
    size: number;
    phase: number;
    speed: number;
    life: number;
  }> = [];
  const createSparkle = () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: 2 + Math.random() * 5,
    phase: Math.random() * Math.PI * 2,
    speed: 0.015 + Math.random() * 0.03,
    life: 0.5 + Math.random() * 0.5,
  });
  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (sparkles.length === 0)
      for (let index = 0; index < 35; index += 1)
        sparkles.push(createSparkle());
  };
  resize();
  window.addEventListener("resize", resize);

  const drawStar = (
    x: number,
    y: number,
    size: number,
    color: string,
    alpha: number,
  ) => {
    context.save();
    context.translate(x, y);
    context.fillStyle = color;
    context.globalAlpha = alpha;
    context.beginPath();
    context.moveTo(0, -size);
    context.quadraticCurveTo(size * 0.15, -size * 0.15, size, 0);
    context.quadraticCurveTo(size * 0.15, size * 0.15, 0, size);
    context.quadraticCurveTo(-size * 0.15, size * 0.15, -size, 0);
    context.quadraticCurveTo(-size * 0.15, -size * 0.15, 0, -size);
    context.fill();
    context.restore();
  };
  const draw = () => {
    if (!document.body.classList.contains("bg-pattern-sparkles")) {
      window.removeEventListener("resize", resize);
      canvas.remove();
      return;
    }
    requestAnimationFrame(draw);
    context.clearRect(0, 0, width, height);
    const color = effectColor();
    const size = effectSize();
    sparkles.forEach((sparkle) => {
      sparkle.phase += sparkle.speed;
      const pulse = Math.sin(sparkle.phase);
      const alpha = Math.max(0, pulse) * 0.25 * sparkle.life;
      const scale = 0.5 + Math.max(0, pulse) * 0.5;
      if (alpha > 0.01)
        drawStar(
          sparkle.x,
          sparkle.y,
          sparkle.size * scale * size,
          color,
          alpha,
        );
      if (sparkle.phase > Math.PI * 6)
        Object.assign(sparkle, createSparkle());
    });
    context.globalAlpha = 1;
  };
  draw();
}

function startEmbers() {
  if (document.getElementById("embers-canvas")) return;
  const canvas = createEffectCanvas("embers-canvas");
  const context = canvas.getContext("2d");
  if (!context) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;
  const embers: Array<{
    x: number;
    y: number;
    velocityX: number;
    velocityY: number;
    radius: number;
    life: number;
    maxLife: number;
    wobble: number;
    spark: boolean;
  }> = [];
  const createEmber = () => ({
    x: Math.random() * width,
    y: height + Math.random() * 40,
    velocityX: (Math.random() - 0.5) * 0.3,
    velocityY: -0.3 - Math.random() * 0.8,
    radius: 0.3 + Math.random() * 0.6,
    life: 0,
    maxLife: 220 + Math.random() * 220,
    wobble: Math.random() * Math.PI * 2,
    spark: false,
  });
  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (embers.length === 0)
      for (let index = 0; index < 60; index += 1) {
        const ember = createEmber();
        ember.y = Math.random() * height;
        ember.life = Math.random() * ember.maxLife;
        embers.push(ember);
      }
  };
  resize();
  window.addEventListener("resize", resize);
  const rgba = (color: string, alpha: number) => {
    const value = Number.parseInt(color.replace("#", ""), 16);
    return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
  };

  const draw = () => {
    if (!document.body.classList.contains("bg-pattern-embers")) {
      window.removeEventListener("resize", resize);
      canvas.remove();
      return;
    }
    requestAnimationFrame(draw);
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = "rgba(0,0,0,0.18)";
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    const color = effectColor("#c9a95a");
    const size = effectSize();
    for (let index = embers.length - 1; index >= 0; index -= 1) {
      const ember = embers[index];
      ember.wobble += 0.03;
      ember.x += ember.velocityX + Math.sin(ember.wobble) * 0.5;
      ember.y += ember.velocityY;
      ember.life += 1;
      if (ember.life > ember.maxLife || ember.y < -20) {
        embers.splice(index, 1);
        if (embers.length < 70) embers.push(createEmber());
        continue;
      }
      if (!ember.spark && Math.random() < 0.003) ember.spark = true;
      const progress = ember.life / ember.maxLife;
      const fade = Math.min(1, Math.min(progress * 4, (1 - progress) * 3));
      const radius = ember.radius * (ember.spark ? 2.4 : 1) * size;
      const alpha = (ember.spark ? 0.9 : 0.55) * fade;
      const gradient = context.createRadialGradient(
        ember.x,
        ember.y,
        0,
        ember.x,
        ember.y,
        radius * 4,
      );
      gradient.addColorStop(0, rgba(color, alpha));
      gradient.addColorStop(0.4, rgba(color, alpha * 0.3));
      gradient.addColorStop(1, rgba(color, 0));
      context.fillStyle = gradient;
      context.fillRect(
        ember.x - radius * 4,
        ember.y - radius * 4,
        radius * 8,
        radius * 8,
      );
      context.fillStyle = rgba("#ffffff", alpha * 0.6);
      context.beginPath();
      context.arc(ember.x, ember.y, radius * 0.5, 0, Math.PI * 2);
      context.fill();
      ember.spark = false;
    }
    if (Math.random() < 0.015) {
      const origin = Math.random() * width;
      for (let index = 0; index < 5; index += 1) {
        const ember = createEmber();
        ember.x = origin + (Math.random() - 0.5) * 40;
        ember.y = height - 10;
        ember.velocityY *= 1.5;
        embers.push(ember);
      }
    }
    context.globalCompositeOperation = "source-over";
  };
  draw();
}

const EFFECT_STARTERS: Partial<
  Record<BackgroundPattern, () => void>
> = {
  synapse: startSynapse,
  rain: startRain,
  constellations: startConstellations,
  "perlin-flow": startPerlinFlow,
  petals: startPetals,
  sparkles: startSparkles,
  embers: startEmbers,
};

