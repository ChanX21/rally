"use client";

import { useEffect, useRef, useState } from "react";

// A select replacement whose menu always opens BELOW the field, in normal flow,
// so it can never open upward or be clipped by an overflow-hidden phone frame.

const MONO = "var(--font-mono), monospace";

export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Choose…",
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          minHeight: 48,
          padding: "10px 14px",
          boxSizing: "border-box",
          border: `1px solid ${open ? "#315FE8" : "#D9C8BE"}`,
          borderRadius: 12,
          background: "#FFFAF7",
          color: selected ? "#1C1917" : "#766B65",
          font: "inherit",
          fontSize: 15,
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#766B65"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease-out" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          style={{
            margin: "6px 0 0",
            padding: 4,
            listStyle: "none",
            maxHeight: 240,
            overflowY: "auto",
            border: "1px solid #D9C8BE",
            borderRadius: 12,
            background: "#FFFAF7",
            boxShadow: "0 8px 24px rgba(28,25,23,0.1)",
          }}
        >
          {options.map((o) => {
            const on = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    width: "100%",
                    minHeight: 44,
                    padding: "10px 12px",
                    border: 0,
                    borderRadius: 8,
                    background: on ? "#E5ECFF" : "transparent",
                    color: on ? "#315FE8" : "#1C1917",
                    font: "inherit",
                    fontSize: 15,
                    fontWeight: on ? 600 : 400,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  {o.label}
                  {on && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#315FE8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ fontFamily: MONO }}>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
