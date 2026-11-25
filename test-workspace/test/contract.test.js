import assert from "node:assert/strict";
import { test } from "node:test";
import { runIntentChecks } from "../src/extension.js";

function expect(actual) {
  return {
    toEqual(expected) {
      assert.deepEqual(actual, expected);
    }
  };
}

test("accepts a complete intent contract", () => {
  const contract = {
    description: "Validate a requested change",
    requiredFiles: ["src/extension.js"]
  };

  expect(runIntentChecks(contract)).toEqual([]);
});

test("rejects an incomplete intent contract", () => {
  expect(runIntentChecks({ description: "", requiredFiles: [] })).toEqual([
    "Intent description and required files must be provided."
  ]);
});
