import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSignInPath, CREATE_RALLY_PATH, rememberRallyCreation, clearRallyCreation } from "./plan.ts";

test("creating a Rally resumes after first-time onboarding without changing normal sign-in", () => {
  const previous = globalThis.window;
  const storage = new Map();
  globalThis.window = { sessionStorage: { setItem: (key, value) => storage.set(key, value), getItem: (key) => storage.get(key), removeItem: (key) => storage.delete(key) } };
  try {
    assert.equal(afterSignInPath(true), "/app/home");
    rememberRallyCreation();
    assert.equal(afterSignInPath(false), "/app/about-you");
    assert.equal(afterSignInPath(true), CREATE_RALLY_PATH);
    clearRallyCreation();
    assert.equal(afterSignInPath(true), "/app/home");
  } finally { globalThis.window = previous; }
});

test("storage restrictions do not break login or onboarding", () => {
  const previous = globalThis.window;
  globalThis.window = { get sessionStorage() { throw new Error("Storage denied"); } };
  try {
    assert.doesNotThrow(rememberRallyCreation);
    assert.doesNotThrow(clearRallyCreation);
    assert.equal(afterSignInPath(false), "/app/about-you");
    assert.equal(afterSignInPath(true), "/app/home");
  } finally { globalThis.window = previous; }
});
