"use client";

import { useEffect, useRef } from "react";

export type OrbVariant = "active" | "searching" | "celebration" | "mono";

type Props = {
  variant?: OrbVariant;
  size?: number;
  speed?: number;
};

type Point = {
  lat: number;
  lon: number;
  ring: number;
  rs: number;
  ph: number;
  tw: number;
};

const PALETTE: Record<OrbVariant, { dot: [number, number, number]; hot: [number, number, number]; sweep: number; twinkle: number; drift: number }> = {
  active: { dot: [49, 95, 232], hot: [240, 100, 69], sweep: 1.0, twinkle: 1.0, drift: 1.0 },
  searching: { dot: [49, 95, 232], hot: [36, 72, 201], sweep: 0.6, twinkle: 0.8, drift: 1.6 },
  celebration: { dot: [49, 95, 232], hot: [240, 100, 69], sweep: 1.6, twinkle: 1.6, drift: 1.2 },
  mono: { dot: [118, 107, 101], hot: [28, 25, 23], sweep: 0.5, twinkle: 0.6, drift: 0.7 },
};

function buildPoints(): Point[] {
  const rings = 15;
  const pts: Point[] = [];
  for (let i = 0; i <= rings; i++) {
    const lat = -Math.PI / 2 + (Math.PI * i) / rings;
    const n = Math.max(1, Math.round(26 * Math.cos(lat)));
    const rs = (i % 2 ? 1 : -1) * (0.12 + 0.1 * Math.sin(i * 1.7));
    for (let j = 0; j < n; j++) {
      pts.push({
        lat,
        lon: (2 * Math.PI * j) / n + (i % 2) * (Math.PI / n),
        ring: i,
        rs,
        ph: ((i * 37 + j * 91) % 628) / 100,
        tw: 0.8 + ((i * 13 + j * 7) % 16) / 10,
      });
    }
  }
  return pts;
}

function rotate(
  x: number,
  y: number,
  z: number,
  ax: number,
  ay: number,
  az: number
): [number, number, number] {
  let c = Math.cos(ax);
  let s = Math.sin(ax);
  [y, z] = [y * c - z * s, y * s + z * c];
  c = Math.cos(ay);
  s = Math.sin(ay);
  [x, z] = [x * c + z * s, -x * s + z * c];
  c = Math.cos(az);
  s = Math.sin(az);
  [x, y] = [x * c - y * s, x * s + y * c];
  return [x, y, z];
}

/**
 * Rally orb: a globe of dots. Rings drift at their own speeds, the surface breathes,
 * dots twinkle, and a coral pulse sweeps across the front. Front dots are larger and
 * darker; back dots fade. Variants keep the motion and change colour and energy.
 */
export default function RallyOrb({ variant = "active", size = 480, speed = 0.75 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const ptsRef = useRef<Point[]>([]);
  const t0Ref = useRef(0);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    ptsRef.current = buildPoints();
    t0Ref.current = performance.now();

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = (now: number) => {
      const S = Math.round(size * 1.12);
      const W = S * 2;
      if (cv.width !== W) {
        cv.width = W;
        cv.height = W;
      }
      const o = PALETTE[variant] ?? PALETTE.active;
      const t = ((now - t0Ref.current) / 1000) * (speed / 0.75) + 2;
      const R = W * 0.38;
      const k = W / 560;

      ctx.clearRect(0, 0, W, W);
      const ax = Math.sin(t * 0.23) * 0.9 + 0.3;
      const ay = t * 0.4;
      const az = Math.sin(t * 0.17) * 0.5;
      const wave = Math.sin(t * 0.9) * 1.2;

      const list: Array<[[number, number, number], number, number, Point]> = [];
      for (const p of ptsRef.current) {
        const lon = p.lon + t * p.rs * o.drift;
        const lat = p.lat + 0.05 * Math.sin(t * 1.1 + p.ring * 0.8 + lon * 2);
        const br = 1 + 0.045 * Math.sin(t * 2.1 + p.lat * 3 + lon * 2) + 0.025 * Math.sin(t * 3.3 + p.ph);
        const cx = Math.cos(lat) * Math.cos(lon) * br;
        const cy = Math.sin(lat) * br;
        const cz = Math.cos(lat) * Math.sin(lon) * br;
        list.push([rotate(cx, cy, cz, ax, ay, az), cy, cx, p]);
      }
      list.sort((a, b) => a[0][2] - b[0][2]);

      for (const [q, oy, ox, p] of list) {
        const depth = (q[2] + 1) / 2;
        const x = W / 2 + q[0] * R;
        const y = W / 2 - q[1] * R;
        const pulse = Math.exp(-Math.pow(oy + ox * 0.4 - wave, 2) * 6) * Math.max(0, q[2]) * o.sweep;
        const tw = Math.pow(Math.max(0, Math.sin(t * p.tw + p.ph)), 8) * o.twinkle;
        const dotSize = (1.5 + depth * 3.9) * k * (1 + pulse * 0.8 + tw * 0.7);
        const mix = Math.min(1, pulse * 1.4 + tw * 0.35 * depth);
        const c = o.dot.map((v, i) => Math.round(v * (1 - mix) + o.hot[i] * mix));
        const a = Math.min(1, 0.1 + depth * 0.85 + tw * 0.2);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const frame = (now: number) => {
      rafRef.current = 0;
      draw(now);
      if (!reduce && speed > 0) rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [variant, size, speed]);

  const S = Math.round(size * 1.12);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ display: "block", width: `${S}px`, height: `${S}px`, flexShrink: 0 }}
    />
  );
}
