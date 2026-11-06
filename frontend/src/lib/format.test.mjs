import assert from "node:assert/strict";
import { test } from "node:test";
import { preferenceText, preferenceNotes, preferencesFromNotes } from "./format.ts";

test("preferences show readable labels and preserve custom wording", () => {
  assert.equal(preferenceText("gaming_game", "chess"), "Gaming: Chess");
  assert.equal(preferenceText("food_style", "sit_down"), "Food: Sit-down meals");
  assert.equal(preferenceText("coffee_energy", "any"), "Coffee: No preference");
  assert.equal(preferenceText("workshop_topic", "ai"), "Workshops: AI");
  assert.equal(preferenceText("custom_gaming", "Co-op Minecraft, no PvP"), "Gaming: Co-op Minecraft, no PvP");
  assert.equal(preferenceText("custom_support", "Quiet one-on-one chat"), "Support: Quiet one-on-one chat");
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
