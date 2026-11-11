import { placeMapUrl, shortPlace } from "@/lib/format";

export default function PlaceTag({ place }: { place?: string | null }) {
  if (!place?.trim()) return <span style={{ fontSize: 12, color: "#766B65" }}>Place shared with crew</span>;
  return <a href={placeMapUrl(place)} target="_blank" rel="noopener noreferrer" title={`Open ${place} in Google Maps`}
    style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "fit-content", maxWidth: "100%", padding: "7px 10px", borderRadius: 999, background: "#E5ECFF", color: "#315FE8", fontSize: 12, textDecoration: "none" }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortPlace(place)}</span><span aria-hidden="true">↗</span>
  </a>;
}
