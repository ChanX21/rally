import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFromIntent, rallyDraftProblem, rallyInputFromDraft } from "./rally-draft.ts";

const intent = () => ({ id: "intent-1", category: "coffee", goal: "Coffee and conversation", windowStart: new Date(Date.now() + 3600000).toISOString(), durationMin: 30, groupMin: null, groupMax: null, zone: "venue-floor-1", vibe: "any", preferences: { custom_coffee: "Quiet conversation" } });

test("a new activity defaults to two people and produces a published, bounded plan", () => {
  const draft = draftFromIntent(intent());
  assert.equal(draft.groupMin, "2"); assert.equal(draft.capacity, "2");
  assert.equal(rallyDraftProblem(draft), null);
  const input = rallyInputFromDraft(draft, "intent-1");
  assert.equal(input.publish, true); assert.equal(input.intentId, "intent-1");
  assert.equal(input.capacity, 2); assert.equal(input.groupMin, 2);
  assert.equal(Date.parse(input.windowEnd) - Date.parse(input.windowStart), 30 * 60000);
  assert.deepEqual(input.preferences, { custom_coffee: "Quiet conversation" });
});

test("explicit user sizes and ranges survive review", () => {
  const draft = draftFromIntent({ ...intent(), groupMin: 3, groupMax: 5 });
  const input = rallyInputFromDraft(draft, "intent-1");
  assert.equal(input.groupMin, 3); assert.equal(input.capacity, 5);
});

test("invalid or incomplete plans cannot be published", () => {
  const valid = draftFromIntent(intent());
  for (const patch of [{ goal: " " }, { category: "unknown" }, { start: "" }, { start: "2020-01-01T12:00" }, { durationMin: "0" }, { durationMin: "30.5" }, { groupMin: "4", capacity: "2" }, { capacity: "13" }, { zone: "unknown" }, { vibe: "unknown" }]) {
    assert.ok(rallyDraftProblem({ ...valid, ...patch }));
    assert.throws(() => rallyInputFromDraft({ ...valid, ...patch }, "intent-1"));
  }
});
