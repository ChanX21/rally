import assert from "node:assert/strict";
import { test } from "node:test";
import { preferenceText } from "./format.ts";

test("preferences show readable labels and preserve custom wording", () => {
  assert.equal(preferenceText("gaming_game", "chess"), "Gaming: Chess");
  assert.equal(preferenceText("food_style", "sit_down"), "Food: Sit-down meals");
  assert.equal(preferenceText("coffee_energy", "any"), "Coffee: No preference");
  assert.equal(preferenceText("workshop_topic", "ai"), "Workshops: AI");
  assert.equal(preferenceText("custom_gaming", "Co-op Minecraft, no PvP"), "Gaming: Co-op Minecraft, no PvP");
  assert.equal(preferenceText("custom_support", "Quiet one-on-one chat"), "Support: Quiet one-on-one chat");
});
