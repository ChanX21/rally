import assert from "node:assert/strict";
import { test } from "node:test";
import { CATEGORIES, preferenceText, preferenceNotes, preferencesFromNotes, matchingProgressLabels, clockCountdown, durationLabel, scheduleTime } from "./format.ts";
import { CATEGORIES as BACKEND_CATEGORIES } from "../../../backend/src/domain/catalog.ts";

test("frontend activity choices stay in sync with the backend and display new preferences", () => {
  assert.deepEqual(CATEGORIES.map((category) => category.id).sort(), [...BACKEND_CATEGORIES].sort());
  assert.equal(preferenceNotes({ custom_music: "Live Jazz", custom_books: "Science Fiction" }), "Music: Live Jazz\nBooks: Science Fiction");
});

test("preferences show readable labels and preserve custom wording", () => {
  assert.equal(preferenceText("gaming_game", "chess"), "Gaming: Chess");
  assert.equal(preferenceText("food_style", "sit_down"), "Food: Sit-down meals");
  assert.equal(preferenceText("coffee_energy", "any"), "Coffee: No preference");
  assert.equal(preferenceText("workshop_topic", "ai"), "Workshops: AI");
  assert.equal(preferenceText("custom_gaming", "Co-op Minecraft, no PvP"), "Gaming: Co-op Minecraft, no PvP");
  assert.equal(preferenceText("custom_support", "Quiet one-on-one chat"), "Support: Quiet one-on-one chat");
});

test("matching progress uses natural empty states and singular/plural counts", () => {
  assert.deepEqual(matchingProgressLabels({ identified: 0, accepted: 0 }), { identified: "No matches yet", accepted: "No one has accepted yet" });
  assert.deepEqual(matchingProgressLabels({ identified: 1, accepted: 0 }), { identified: "1 match identified", accepted: "No one has accepted yet" });
  assert.deepEqual(matchingProgressLabels({ identified: 3, accepted: 1 }), { identified: "3 matches identified", accepted: "1 accepted" });
});

test("one notes field includes saved and appended preferences without exposing private fields", () => {
  const preferences = { custom_build: "EthGlobal", coffee_energy: "any", custom_workshop: "Candle light making", gaming_game: "valorant", food_style: "sit_down", private_note: "not matching context" };
  const text = preferenceNotes(preferences);
  assert.equal(text, "Build: EthGlobal\nWorkshop: Candle light making\nGaming: Valorant\nFood: Sit-down meals");
  const saved = preferencesFromNotes(text, preferences);
  assert.deepEqual(saved, { private_note: "not matching context", matching_notes: text });
  assert.equal(preferenceNotes(saved), text);
  assert.equal(preferenceNotes({ ...saved, custom_networking: "Meet founders" }), `${text}\nNetworking: Meet founders`);
  assert.deepEqual(preferencesFromNotes("  ", saved), { private_note: "not matching context" });
});

test("clock countdown shows hours, then days, and stops at zero", () => {
  assert.equal(clockCountdown(4_325_000), "01:12:05");
  assert.equal(clockCountdown(999), "00:00:01");
  assert.equal(clockCountdown(-5_000), "00:00:00");
  assert.equal(clockCountdown(187_200_000), "2d 4h");
});

test("duration label reads in minutes and hours", () => {
  assert.equal(durationLabel(45), "45 min");
  assert.equal(durationLabel(60), "1 h");
  assert.equal(durationLabel(90), "1 h 30 min");
});

test("schedule time adds the date only for other days", () => {
  const now = new Date(2026, 10, 6, 12, 0).getTime();
  assert.doesNotMatch(scheduleTime(new Date(2026, 10, 6, 20, 0).getTime(), now), /Nov/);
  assert.match(scheduleTime(new Date(2026, 10, 8, 20, 0).getTime(), now), /Nov.*20:00/);
});
