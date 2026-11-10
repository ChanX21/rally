import assert from "node:assert/strict";
import { test } from "node:test";
import { myRallySections } from "./my-rallies.ts";

const rally = (id, status, day) => ({ id, status, windowStart: `2026-11-${day}T09:00:00Z` });
const match = (id, status, rallyStatus = "open", holdUntil = "2026-11-13T00:00:00Z", rallyId = id) => ({ id, status, holdUntil, rally: { id: rallyId, status: rallyStatus } });

test("sorts and deduplicates current rallies and separates past rallies", () => {
  const result = myRallySections([rally("later", "formed", "14"), rally("first", "open", "12"), rally("first", "open", "12"), rally("old", "completed", "10"), rally("cancelled", "cancelled", "11")], [], Date.parse("2026-11-10T00:00:00Z"));
  assert.deepEqual(result.current.map(r => r.id), ["first", "later"]);
  assert.deepEqual(result.past.map(r => r.id), ["cancelled", "old"]);
});

test("only actionable invitations appear and joined rallies are not duplicated", () => {
  const result = myRallySections([rally("joined", "formed", "12")], [match("new", "pending"), match("accepted", "accepted"), match("expired", "pending", "open", "2026-11-09T00:00:00Z"), match("closed", "pending", "cancelled"), match("joined-offer", "pending", "open", "2026-11-13T00:00:00Z", "joined")], Date.parse("2026-11-10T00:00:00Z"));
  assert.deepEqual(result.invitations.map(m => m.id), ["new"]);
});
