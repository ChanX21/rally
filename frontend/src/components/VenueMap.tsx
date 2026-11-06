"use client";

import { useEffect, useState } from "react";

// A decorative, non-identifying map of the venue: labelled zones with anonymous
// dots that drift. The dot count reflects how many rallies are currently open —
// positions are ambient, never a real location. Every few seconds a speech bubble
// pops up near a random dot.

type Zone = { x: number; y: number; w: number; h: number; label: string; fill: string };

const PEACH = "#F1D9C9";
const GREY = "#E7DFD8";
const BLUE = "#DCE1F5";

// Lines a dot can say. For now just a placeholder — the backend will supply real
// snippets later (e.g. what that group is rallying for).
const MESSAGES = ["hello"];

const ZONES: Zone[] = [
  { x: 64, y: 64, w: 232, h: 96, label: "FOOD COURT", fill: PEACH },
  { x: 312, y: 64, w: 168, h: 96, label: "WORKSHOPS", fill: GREY },
  { x: 496, y: 64, w: 344, h: 96, label: "", fill: BLUE },
  { x: 64, y: 176, w: 232, h: 128, label: "", fill: BLUE },
  { x: 312, y: 176, w: 300, h: 160, label: "HACKING", fill: BLUE },
  { x: 628, y: 176, w: 212, h: 160, label: "MAIN HALL", fill: GREY },
  { x: 64, y: 320, w: 232, h: 80, label: "ACTIVITIES", fill: PEACH },
  { x: 64, y: 416, w: 152, h: 80, label: "ENTRY", fill: GREY },
  { x: 232, y: 416, w: 184, h: 80, label: "MENTORS", fill: GREY },
  { x: 432, y: 416, w: 408, h: 80, label: "JUDGING", fill: GREY },
];

// Ordered so filling the first N spreads evenly across the venue (one per zone,
// round by round) while matching the reference's clusters.
const POOL: [number, number][] = [
  [150, 118], [350, 116], [545, 100], [120, 214], [405, 228], [772, 268], [96, 352], [178, 452], [250, 440], [784, 452],
  [170, 118], [410, 126], [560, 126], [184, 200], [424, 252], [786, 268], [122, 352],
  [715, 86], [208, 236], [452, 258], [168, 362],
  [802, 128], [458, 304], [184, 362],
  [548, 312],
  [590, 352],
];

type Bubble = { id: number; x: number; y: number; text: string };

export default function VenueMap({ count = POOL.length }: { count?: number }) {
  const n = Math.max(0, Math.min(count, POOL.length));
  const dots = POOL.slice(0, n);
  const [bubble, setBubble] = useState<Bubble | null>(null);

  useEffect(() => {
    if (n === 0) return;
    const avail = POOL.slice(0, n);
    let id = 0;
    let hide: ReturnType<typeof setTimeout>;
    const pop = () => {
      const [x, y] = avail[Math.floor(Math.random() * avail.length)];
      const text = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
      setBubble({ id: id++, x, y, text });
      hide = setTimeout(() => setBubble(null), 2200);
    };
    const timer = setInterval(pop, 3200);
    pop();
    return () => {
      clearInterval(timer);
      clearTimeout(hide);
    };
  }, [n]);

  // Cloud-bubble geometry, clamped to stay inside the frame.
  let bb: { cx: number; cy: number; bw: number; bh: number; dotX: number } | null = null;
  if (bubble) {
    const bw = Math.max(104, bubble.text.length * 17 + 48);
    const bh = 62;
    const cx = Math.min(Math.max(bubble.x, bw / 2 + 12), 904 - bw / 2 - 12);
    const cy = Math.max(bh / 2 + 16, bubble.y - 56 - bh / 2);
    bb = { cx, cy, bw, bh, dotX: bubble.x };
  }

  return (
    <svg viewBox="0 0 904 540" width="100%" role="img" aria-label={`Venue map, ${n} rallies open`} style={{ display: "block" }}>
      <style>{`
        .vm-dot0 { animation: vmDrift0 4.5s ease-in-out infinite; }
        .vm-dot1 { animation: vmDrift1 5.5s ease-in-out infinite; }
        .vm-dot2 { animation: vmDrift2 4s ease-in-out infinite; }
        .vm-dot3 { animation: vmDrift3 6s ease-in-out infinite; }
        @keyframes vmDrift0 { 0%,100% { transform: translate(0,0); } 25% { transform: translate(11px,7px); } 50% { transform: translate(4px,16px); } 75% { transform: translate(-9px,7px); } }
        @keyframes vmDrift1 { 0%,100% { transform: translate(0,0); } 33% { transform: translate(-13px,9px); } 66% { transform: translate(10px,-9px); } }
        @keyframes vmDrift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(15px,-12px); } }
        @keyframes vmDrift3 { 0%,100% { transform: translate(0,0); } 40% { transform: translate(-8px,-15px); } 80% { transform: translate(13px,6px); } }
        .vm-bubble { animation: vmPop .26s ease-out both; }
        @keyframes vmPop { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .vm-dot0, .vm-dot1, .vm-dot2, .vm-dot3, .vm-bubble { animation: none; }
        }
      `}</style>

      {ZONES.map((z) => (
        <g key={`${z.x}-${z.y}`}>
          <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="14" fill={z.fill} />
          {z.label && (
            <text
              x={z.x + 18}
              y={z.y + 33}
              fontFamily="var(--font-mono), ui-monospace, monospace"
              fontSize="22"
              fontWeight="500"
              letterSpacing="1.5"
              fill="#6E635B"
            >
              {z.label}
            </text>
          )}
        </g>
      ))}

      {/* Food court bullseye — concentric orange/blue rings with a radar ping */}
      <g>
        <circle cx="240" cy="112" r="16" fill="none" stroke="#315FE8" strokeWidth="4">
          <animate attributeName="r" values="16;27;16" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.12;1" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="240" cy="112" r="16" fill="none" stroke="#EC562E" strokeWidth="3" />
        <circle cx="240" cy="112" r="9" fill="none" stroke="#315FE8" strokeWidth="3.5" />
        <circle cx="240" cy="112" r="4" fill="#EC562E" />
      </g>

      {/* Main hall pin — filled orange disc with a white ring, gently pulsing */}
      <g>
        <circle cx="710" cy="258" r="18" fill="#EC562E">
          <animate attributeName="r" values="18;21;18" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="710" cy="258" r="9" fill="none" stroke="#FFF5EF" strokeWidth="3" />
      </g>

      {/* Activities donut */}
      <circle cx="250" cy="360" r="14" fill="#FDEFE8" stroke="#EC562E" strokeWidth="6" />

      {/* One dot per open rally */}
      {dots.map(([x, y], i) => (
        <circle key={i} className={`vm-dot${i % 4}`} cx={x} cy={y} r="8" fill="#1C1917" />
      ))}

      {/* Random speech bubble near a dot */}
      {bubble && bb && (
        <g key={bubble.id} className="vm-bubble" fill="#1C1917">
          <path d={`M${bb.cx - 9} ${bb.cy + bb.bh / 2 - 1} L${bb.cx + 9} ${bb.cy + bb.bh / 2 - 1} L${bb.cx} ${bb.cy + bb.bh / 2 + 13} Z`} />
          <rect x={bb.cx - bb.bw / 2} y={bb.cy - bb.bh / 2} width={bb.bw} height={bb.bh} rx="16" />
          <text
            x={bb.cx}
            y={bb.cy + 9}
            textAnchor="middle"
            fontFamily="var(--font-inter), system-ui, sans-serif"
            fontSize="26"
            fontWeight="600"
            fill="#FFF5EF"
          >
            {bubble.text}
          </text>
        </g>
      )}
    </svg>
  );
}
