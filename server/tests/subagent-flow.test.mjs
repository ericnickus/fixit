import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptBundle } from "../modules/promptBuilder.js";
import { runPlannerSubagent } from "../modules/plannerSubagent.js";
import { cleanAndNormalizeResponse } from "../modules/responseCleaner.js";

const intake = {
  repairGoal: "Restore dryer heat",
  deviceType: "Dryer",
  brand: "Whirlpool",
  model: "ABC123",
  ageYears: "7",
  symptom: "Dryer tumbles but does not dry clothes",
  exactWhen: "Starts warm then goes cold",
  soundSmell: "No unusual smell",
  errorCodes: "",
  attemptedFixes: "Cleaned lint trap",
  availableTools: "Screwdriver, multimeter",
  confidenceLevel: "Beginner",
  safetyConcerns: "No gas work",
  locationSetup: "Laundry closet",
  budgetBand: "0-150",
  urgency: "High",
  constraints: "Need it tonight"
};

test("planner subagent uses configured low-cost model", async () => {
  let capturedPayload = null;

  const fakeOpenAI = {
    responses: {
      create: async (payload) => {
        capturedPayload = payload;
        return {
          output_text: JSON.stringify({
            title: "Dryer Heat Recovery Plan",
            simpleSummary: "Short actionable plan.",
            partsNeeded: ["Multimeter"],
            toolSuggestions: ["Use leverage over force"],
            steps: [
              {
                id: "step_1",
                title: "Check thermal fuse",
                action: "Test thermal fuse continuity.",
                whyImportant: "Fuse failures are common.",
                caution: "Unplug unit.",
                doneCheck: "Continuity confirmed.",
                fallbackAction: "Move to thermostat check.",
                failedNextId: null,
                tools: ["Multimeter"]
              }
            ]
          })
        };
      }
    }
  };

  const promptBundle = buildPromptBundle(intake, []);

  const result = await runPlannerSubagent({
    openaiClient: fakeOpenAI,
    lowCostModel: "gpt-4.1-mini",
    promptBundle,
    intake,
    priorHints: []
  });

  assert.equal(capturedPayload.model, "gpt-4.1-mini");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].id, "step_1");
});

test("response cleaner strips low-signal filler and preserves actionable content", () => {
  const dirtyJson = JSON.stringify({
    title: "Here is Dryer Plan",
    simpleSummary: "Historically, dryers have used heat cycles.",
    partsNeeded: ["Multimeter"],
    toolSuggestions: ["Use leverage over force", "In general, safety matters"],
    steps: [
      {
        id: "step_1",
        title: "Step One",
        action: "Check the vent path for blockage.",
        whyImportant: "In general this improves airflow.",
        caution: "Unplug before opening panel.",
        doneCheck: "Air moves freely.",
        fallbackAction: "If blocked, clear lint and retry.",
        tools: ["Screwdriver"]
      }
    ]
  });

  const cleaned = cleanAndNormalizeResponse(dirtyJson, {
    intake,
    priorHints: []
  });

  assert.equal(cleaned.steps.length, 1);
  assert.ok(cleaned.steps[0].action.includes("vent path"));
  assert.ok(!cleaned.simpleSummary.toLowerCase().includes("historically"));
  assert.ok(cleaned.toolSuggestions.some((tip) => tip.toLowerCase().includes("leverage")));
});
