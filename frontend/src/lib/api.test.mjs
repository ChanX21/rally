import assert from "node:assert/strict";
import { test } from "node:test";
import { createApiClient } from "./api.ts";

test("a stuck access-token getter times out instead of leaving the page loading forever", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const api = createApiClient(() => new Promise(() => {}));
  const failed = assert.rejects(api.listRallies(), error => error.code === "TIMEOUT" && /Sign-in/.test(error.message));
  t.mock.timers.tick(20_000);
  await failed;
});
