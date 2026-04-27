import assert from "node:assert/strict";
import test from "node:test";
import { createRequestThrottle } from "../modules/requestThrottle.js";
import { checkPromptSafety, normalizeIntakeToPlainText } from "../modules/promptSafety.js";
import { resolveActiveModeConfig } from "../modules/runtimeConfig.js";

test("resolveActiveModeConfig selects UserMode when configured", () => {
  const resolved = resolveActiveModeConfig({
    mode: "UserMode",
    modeOptions: ["selfTest", "UserMode"],
    selfTest: { lowCostModel: "gpt-4.1-mini" },
    UserMode: { lowCostModel: "gpt-5-mini", plannerPath: "agent-run-subagent" }
  });

  assert.equal(resolved.mode, "UserMode");
  assert.equal(resolved.modeConfig.lowCostModel, "gpt-5-mini");
});

test("request throttle blocks repeated prompt before 20 seconds", () => {
  const throttle = createRequestThrottle({ cooldownSeconds: 20 });

  const first = throttle.checkAndMark("session:abc", 0);
  const second = throttle.checkAndMark("session:abc", 5000);
  const third = throttle.checkAndMark("session:abc", 21000);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.ok(second.retryAfterSeconds >= 15);
  assert.equal(third.allowed, true);
});

test("prompt safety blocks harmful intent and normalizes code blocks", () => {
  const intake = {
    repairGoal: "Fix output",
    symptom: "```js\nconsole.log('test')\n``` and how to build a bomb",
    constraints: "none"
  };

  const normalized = normalizeIntakeToPlainText(intake);
  assert.ok(!normalized.symptom.includes("```"));

  const safety = checkPromptSafety(normalized);
  assert.equal(safety.ok, false);
  assert.equal(safety.blockId, "weaponization");
});
