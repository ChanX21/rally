"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";
import RallyLoader from "@/components/RallyLoader";

const MAX_PHOTOS = 3;
const MAX_EDGE_PX = 1600;

// Phone cameras can exceed the backend's 20 MP and 5 MB limits, and galleries can hand over HEIC or
// WebP. Re-encoding accepts anything the browser can open and keeps location metadata on the device.
// The result is stored once, so a retry sends identical bytes under the same idempotency key.
async function toUploadableJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read photo");
    context.fillStyle = "#FFFFFF"; // JPEG has no transparency; a transparent PNG would turn black.
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const photo = canvas.toDataURL("image/jpeg", 0.85);
    if (!photo.startsWith("data:image/jpeg;base64,")) throw new Error("Could not read photo");
    return photo;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function RallyProof({ rallyId, onUnsentChange }: { rallyId: string; onUnsentChange?: (unsent: boolean) => void }) {
  const { api } = useSession();
  const load = useCallback(() => api.getProof(rallyId), [api, rallyId]);
  const { data: proof, error, refresh, setData } = usePolled(load, 10_000);
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pickProblem, setPickProblem] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const unsent = Boolean(proof?.canSubmit) && photos.length > 0;
  useEffect(() => {
    onUnsentChange?.(unsent);
    return () => onUnsentChange?.(false);
  }, [onUnsentChange, unsent]);

  const addPhotos = async (input: HTMLInputElement) => {
    const selected = Array.from(input.files ?? []);
    input.value = ""; // Lets the same photo be picked again after it is removed.
    if (!selected.length) return;
    setAdding(true);
    const next = [...photos];
    let issue: string | null = null;
    for (const file of selected) {
      if (next.length === MAX_PHOTOS) {
        issue = `You can add up to ${MAX_PHOTOS} photos.`;
        break;
      }
      try {
        const photo = await toUploadableJpeg(file);
        if (next.includes(photo)) issue = "That photo is already added.";
        else next.push(photo);
      } catch {
        issue = "We couldn't open that photo. Try a different one.";
      }
    }
    requestKey.current = null;
    setPhotos(next);
    setPickProblem(issue);
    setProblem(null);
    setAdding(false);
  };

  const removePhoto = (index: number) => {
    requestKey.current = null;
    setPhotos((current) => current.filter((_, i) => i !== index));
    setPickProblem(null);
    setProblem(null);
  };

  const submit = async () => {
    if (!photos.length || busy) return;
    setBusy(true);
    setPickProblem(null);
    setProblem(null);
    requestKey.current ??= crypto.randomUUID();
    try {
      setData(await api.submitProof(rallyId, { images: photos, note }, requestKey.current));
      setPhotos([]);
      setNote("");
      requestKey.current = null;
    } catch (err) {
      setProblem(errorMessage(err));
      refresh(); // Another member may have submitted first, which closes this form.
    } finally {
      setBusy(false);
    }
  };

  // A phone opens its camera directly; elsewhere `capture` is ignored and would open a file picker.
  // Checked here because this only renders after the proof loads, never on the server.
  const canUseCamera = proof != null && window.matchMedia("(pointer: coarse)").matches;
  const full = photos.length === MAX_PHOTOS;

  return <section className="card" style={{ padding: 16, display: "grid", gap: 12 }} aria-label="Group photo rewards">
    <h2 style={{ fontSize: 18, margin: 0 }}>Photos for group rewards</h2>
    {!proof && !error && <RallyLoader context="photos" />}
    {!proof && error != null && <p role="alert">{errorMessage(error)}</p>}
    {proof && <>
      <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        {proof.state === "accepted" ? `Group rewarded: ${proof.rewardedCount} people earned ${proof.rewardAmount} RALLY each.`
          : proof.state === "processing" ? "Checking your group’s photos. You can leave this page; we’ll notify you."
          : proof.state === "unavailable" ? "Photo checking is temporarily unavailable. Your Rally is still completed."
          : proof.state === "needs_clearer_photos" ? proof.reason
          : `Optional: one person can add 1–3 photos of the group doing this activity. Accepted photos earn ${proof.rewardAmount} RALLY for every confirmed participant.`}
      </p>
      {proof.canSubmit && <>
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addPhotos(e.target)} />
        <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target)} />
        <div className="proof-picks">
          {canUseCamera && (
            <button className="proof-pick" type="button" disabled={busy || adding || full} onClick={() => cameraInput.current?.click()}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.7l1.5-2.5h6.6L16.8 7h2.7A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              Take photo
            </button>
          )}
          <button className="proof-pick" type="button" disabled={busy || adding || full} onClick={() => galleryInput.current?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <circle cx="8.5" cy="9.5" r="1.5" />
              <path d="m21 16-5-5L6 20" />
            </svg>
            Upload photos
          </button>
        </div>
        {photos.length > 0 && (
          <ul className="proof-thumbs" aria-label={`${photos.length} of ${MAX_PHOTOS} photos added`}>
            {photos.map((photo, index) => (
              <li key={photo} className="proof-thumb">
                {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                <img src={photo} alt={`Photo ${index + 1}`} />
                <button type="button" disabled={busy} aria-label={`Remove photo ${index + 1}`} onClick={() => removePhoto(index)}>
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Sits beside the pickers: on a phone the bottom of this card is off screen while choosing. */}
        {pickProblem && <p role="alert" style={{ margin: 0, color: "#A33A1E", fontSize: 14 }}>{pickProblem}</p>}
        <p aria-live="polite" style={{ margin: 0, fontSize: 13, color: "#766B65" }}>
          {adding ? "Adding photo…" : `${photos.length} of ${MAX_PHOTOS} added · ${proof.submissionsLeft} ${proof.submissionsLeft === 1 ? "try" : "tries"} left · open until ${new Date(proof.closesAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
        </p>
        <label style={{ display: "grid", gap: 8, fontSize: 14 }}>A short note (optional)
          <textarea value={note} maxLength={300} rows={2} disabled={busy} onChange={(e) => { setNote(e.target.value); requestKey.current = null; }} style={{ font: "inherit", border: "1px solid #D9C8BE", borderRadius: 8, padding: 8 }} />
        </label>
        <p style={{ margin: 0, fontSize: 12, color: "#766B65", lineHeight: 1.5 }}>Only share photos you have permission to submit. Photos are privately processed with Rally intelligence and deleted after 30 days. They are never posted publicly or on-chain.</p>
        <button className="btn btn-p" type="button" disabled={busy || adding || !photos.length} onClick={() => void submit()}>{busy ? "Sending photos…" : "Submit group photos"}</button>
      </>}
      {!proof.canSubmit && !["processing", "accepted"].includes(proof.state) && <p style={{ margin: 0, fontSize: 13 }}>No further photo submissions are available for this Rally right now. Your Rally remains completed.</p>}
    </>}
    {problem && <p role="alert" style={{ margin: 0, color: "#A33A1E", fontSize: 14 }}>{problem}</p>}
  </section>;
}
