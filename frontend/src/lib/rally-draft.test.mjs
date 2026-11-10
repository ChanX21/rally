import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFromIntent, rallyDraftIssues, rallyDraftProblem, rallyInputFromDraft, TYPED_AREA_ZONE } from "./rally-draft.ts";

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
  for (const patch of [{ goal: " " }, { category: "unknown" }, { start: "" }, { start: "2020-01-01T12:00" }, { durationMin: "0" }, { durationMin: "3" }, { durationMin: "30.5" }, { groupMin: "4", capacity: "2" }, { capacity: "13" }, { zone: " " }, { vibe: "unknown" }]) {
    assert.ok(rallyDraftProblem({ ...valid, ...patch }));
    assert.throws(() => rallyInputFromDraft({ ...valid, ...patch }, "intent-1"));
  }
});

test("a fallback asks for a real start and missing meeting area, keeping optional defaults out of the questions", () => {
  const draft = draftFromIntent({ ...intent(), source: "fallback", category: "workshop", zone: null, durationMin: 45 });
  assert.equal(draft.start, "");
  assert.deepEqual(Object.keys(rallyDraftIssues(draft)), ["start", "zone"]);
  const confirmed = { ...draft, start: draftFromIntent(intent()).start, zone: "venue-floor-1" };
  assert.deepEqual(rallyDraftIssues(confirmed), {});
  assert.equal(rallyInputFromDraft(confirmed, "intent-1").category, "workshop");
});

test("typed answers survive an AI reparse failure and preserve the user's actual choices", () => {
  const start = draftFromIntent(intent()).start;
  const draft = draftFromIntent({ ...intent(), source: "fallback", zone: null, durationMin: 45 }, {
    start_time: start, duration: "60", distance: "venue-floor-2", group_fit: "quiet", group_size: "4",
  });
  assert.deepEqual(rallyDraftIssues(draft), {});
  const input = rallyInputFromDraft(draft, "intent-1");
  assert.equal(input.durationMin, 60);
  assert.equal(input.zone, "venue-floor-2");
  assert.equal(input.vibe, "quiet");
  assert.equal(input.capacity, 4);
  assert.equal(input.groupMin, 4);
});

test("a typed meeting area stays private while the public zone stays coarse", () => {
  const valid = draftFromIntent(intent());
  const typed = rallyInputFromDraft({ ...valid, zone: "  Pavilion 2 " }, "intent-1");
  assert.equal(typed.zone, TYPED_AREA_ZONE);
  assert.equal(typed.meetingPoint, "Pavilion 2");
  const picked = rallyInputFromDraft({ ...valid, zone: "venue-floor-1" }, "intent-1");
  assert.equal(picked.zone, "venue-floor-1");
  assert.equal("meetingPoint" in picked, false);
});


test("a natural-language answer never overwrites the AI-resolved date with an invalid input", () => {
  const resolved = { ...intent(), windowStart: "2026-11-12T09:35:00.000Z" };
  const draft = draftFromIntent(resolved, { start_time: "12 November at 3:05 PM" });
  assert.equal(new Date(draft.start).toISOString(), resolved.windowStart);
});


test("rallies can be planned up to 60 days ahead, including next month", () => {
  const now = Date.now();
  const valid = draftFromIntent({ ...intent(), windowStart: new Date(now + 45 * 86400000).toISOString() });
  assert.equal(rallyDraftProblem(valid, now), null);
  const tooFar = draftFromIntent({ ...intent(), windowStart: new Date(now + 61 * 86400000).toISOString() });
  assert.match(rallyDraftIssues(tooFar, now).start, /60 days/);
});
