"use client";

import { useId } from "react";
import { CATEGORIES } from "@/lib/format";

const PREFERENCE_OPTIONS: Record<string, { key: string; values: string[] }> = {
  gaming: { key: "gaming_game", values: ["chess", "valorant", "minecraft", "wow", "any"] },
  build: { key: "build_role", values: ["builder", "reviewer", "mentor", "any"] },
  workshop: { key: "workshop_topic", values: ["ai", "web3", "frontend", "any"] },
  food: { key: "food_style", values: ["sit_down", "takeaway", "any"] },
  coffee: { key: "coffee_energy", values: ["quiet", "chatty", "any"] },
  explore: { key: "explore_range", values: ["venue", "nearby", "any"] },
};

export function PreferenceInput({ value, onChange, options = [], className, disabled, placeholder = "Choose a suggestion or type your own" }: {
  value: string; onChange: (value: string) => void;
  options?: { value: string; label: string }[]; className?: string; disabled?: boolean; placeholder?: string;
}) {
  const id = useId();
  return <>
    <input type="text" list={id} disabled={disabled} maxLength={120} value={value} onChange={(e) => onChange(e.target.value)}
      className={className} placeholder={placeholder}
      style={{ width: "100%", minHeight: 48, padding: "10px 12px", boxSizing: "border-box", border: "1px solid #D9C8BE", borderRadius: 12, background: "#FFFAF7", color: "#1C1917", font: "inherit" }} />
    <datalist id={id}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</datalist>
  </>;
}

export function PreferenceEditor({ preferences, onChange, categories, disabled }: {
  preferences: Record<string, string>; onChange: (value: Record<string, string>) => void; categories: string[]; disabled?: boolean;
}) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {CATEGORIES.filter((category) => categories.includes(category.id)).map((category) => {
      const option = PREFERENCE_OPTIONS[category.id];
      const customKey = `custom_${category.id}`;
      return <label key={category.id} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
        <span>{category.label} preference</span>
        <PreferenceInput disabled={disabled} value={preferences[customKey] ?? (option ? preferences[option.key] : "") ?? ""}
          options={option?.values.map((value) => ({ value, label: value === "any" ? "No preference" : value.replaceAll("_", " ") }))}
          onChange={(value) => {
            const next = { ...preferences };
            delete next[customKey];
            if (option) delete next[option.key];
            if (value.trim()) {
              const suggested = option?.values.includes(value.toLowerCase());
              next[suggested ? option.key : customKey] = suggested ? value.toLowerCase() : value;
            }
            onChange(next);
          }} />
      </label>;
    })}
    <span style={{ fontSize: 12, color: "#766B65" }}>Optional. Up to 120 characters per activity. Clear a field to remove it.</span>
  </div>;
}
