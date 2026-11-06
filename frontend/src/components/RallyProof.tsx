"use client";

import { useCallback, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePolled } from "@/lib/usePolled";

export function RallyProof({ rallyId }: { rallyId: string }) {
  const { api } = useSession();
  const load = useCallback(() => api.getProof(rallyId), [api, rallyId]);
  const { data: proof, error, refresh } = usePolled(load, 10_000);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);

  const submit = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    setProblem(null);
    requestKey.current ??= crypto.randomUUID();
    try {
      const images = await Promise.all(files.map((file) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read photo"));
        reader.onerror = () => reject(new Error("Could not read photo"));
        reader.readAsDataURL(file);
      })));
      await api.submitProof(rallyId, { images, note }, requestKey.current);
      setFiles([]);
      setNote("");
      requestKey.current = null;
      refresh();
    } catch (err) { setProblem(errorMessage(err)); }
    finally { setBusy(false); }
  };

  return <section className="card" style={{ padding: 16, display: "grid", gap: 12 }} aria-label="Group photo rewards">
    <h2 style={{ fontSize: 18, margin: 0 }}>Photos for group rewards</h2>
    {!proof && !error && <p role="status">Loading photo status…</p>}
    {error != null && <p role="alert">{errorMessage(error)}</p>}
    {proof && <>
      <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        {proof.state === "accepted" ? `Group rewarded: ${proof.rewardedCount} people earned ${proof.rewardAmount} RALLY each.`
          : proof.state === "processing" ? "Checking your group’s photos. You can leave this page; we’ll notify you."
          : proof.state === "unavailable" ? "Photo checking is temporarily unavailable. Your Rally is still completed."
          : proof.state === "needs_clearer_photos" ? proof.reason
          : `Optional: one person can add 1–3 photos of the group doing this activity. Accepted photos earn ${proof.rewardAmount} RALLY for every confirmed participant.`}
      </p>
      {proof.canSubmit && <>
        <label style={{ display: "grid", gap: 8, fontSize: 14 }}>
          Choose 1–3 JPEG or PNG photos (up to 5 MB each)
          <input type="file" accept="image/jpeg,image/png" multiple disabled={busy} onChange={(e) => {
            const selected = Array.from(e.target.files ?? []);
            requestKey.current = null;
            if (selected.length > 3 || selected.some((f) => f.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(f.type))) {
              setProblem("Choose up to three JPEG or PNG photos, each 5 MB or smaller."); setFiles([]); e.target.value = ""; return;
            }
            setFiles(selected); setProblem(null);
          }} />
        </label>
        <label style={{ display: "grid", gap: 8, fontSize: 14 }}>A short note (optional)
          <textarea value={note} maxLength={300} rows={2} disabled={busy} onChange={(e) => { setNote(e.target.value); requestKey.current = null; }} style={{ font: "inherit", border: "1px solid #D9C8BE", borderRadius: 8, padding: 8 }} />
        </label>
        <p style={{ margin: 0, fontSize: 12, color: "#766B65", lineHeight: 1.5 }}>Only share photos you have permission to submit. Photos are privately processed with Rally intelligence and deleted after 30 days. They are never posted publicly or on-chain.</p>
        <button className="btn btn-p" type="button" disabled={busy || !files.length} onClick={() => void submit()}>{busy ? "Sending photos…" : "Submit group photos"}</button>
      </>}
      {!proof.canSubmit && !["processing", "accepted"].includes(proof.state) && <p style={{ margin: 0, fontSize: 13 }}>No further photo submissions are available for this Rally right now. Your Rally remains completed.</p>}
    </>}
    {problem && <p role="alert" style={{ margin: 0, color: "#A33A1E", fontSize: 14 }}>{problem}</p>}
  </section>;
}
