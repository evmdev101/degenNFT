import { useState } from "react";
import type { CSSProperties, PointerEvent } from "react";

export function CashxArtwork({ imageUrl }: { imageUrl: string }) {
  const [lightOn, setLightOn] = useState(true);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [light, setLight] = useState({ x: 50, y: 42 });

  const moveLight = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
    );
    const y = Math.max(
      0,
      Math.min(100, ((event.clientY - rect.top) / rect.height) * 100),
    );
    setLight({ x, y });
    setTilt({
      x: (0.5 - y / 100) * 7,
      y: (x / 100 - 0.5) * 9,
    });
  };

  const resetTilt = () => {
    setTilt({ x: 0, y: 0 });
    setLight({ x: 50, y: 42 });
  };

  const cardStyle = {
    transform: `rotateY(${tilt.y}deg) rotateX(${tilt.x}deg)`,
  } satisfies CSSProperties;

  const lightStyle = {
    opacity: lightOn ? 0.85 : 0,
    background: `radial-gradient(circle at ${light.x}% ${light.y}%, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.1) 28%, transparent 58%)`,
  } satisfies CSSProperties;

  return (
    <div className="cashx-artwork">
      <div
        className="cashx-artwork-stage"
        onPointerMove={moveLight}
        onPointerLeave={resetTilt}
      >
        <div className="cashx-artwork-card" style={cardStyle}>
          <img
            className="cashx-artwork-image"
            src={imageUrl}
            alt="DegenStrategy NFT Miner"
            draggable="false"
          />
          <div
            className="cashx-artwork-light"
            style={lightStyle}
            aria-hidden="true"
          />
        </div>
      </div>
      <div className="cashx-artwork-reflection" aria-hidden="true">
        <img src={imageUrl} alt="" draggable="false" />
      </div>
      <div className="cashx-artwork-light-control">
        <button
          type="button"
          title="Toggle the light effect"
          aria-pressed={lightOn}
          onClick={() => setLightOn((current) => !current)}
        >
          Light {lightOn ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}
