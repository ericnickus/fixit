import assert from "node:assert/strict";
import test from "node:test";
import { buildPromptBundle } from "../ai-processing/promptBuilder.js";
import { runPlannerSubagent } from "../ai-processing/plannerSubagent.js";
import { cleanAndNormalizeResponse } from "../ai-processing/responseCleaner.js";

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

test("planner subagent runs single-pass planning with configured model", async () => {
  const capturedPayloads = [];
  let callCount = 0;

  const fakeOpenAI = {
    responses: {
      create: async (payload) => {
        callCount += 1;
        capturedPayloads.push(payload);

        return {
          output_text: JSON.stringify({
            title: "Dryer Heat Recovery Plan",
            simpleSummary: "Short actionable plan.",
            prepPaths: {
              tools: { best: "use full tool set", hack: "use safe substitute tools" },
              budget: { best: "spend for reliability", hack: "workaround-first spend" }
            },
            partsNeeded: ["Multimeter"],
            toolSuggestions: ["Use leverage over force"],
            steps: [
              {
                id: "step_1",
                title: "Check thermal fuse",
                action: "Test thermal fuse continuity.",
                alternateAction: "Inspect visible fuse path if meter unavailable.",
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

  assert.equal(callCount, 1);
  assert.equal(capturedPayloads[0].model, "gpt-4.1-mini");
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].id, "step_1");
});

test("prompt bundle hard-codes no-reasoning action-only instructions", () => {
  const promptBundle = buildPromptBundle(intake, []);

  assert.ok(promptBundle.systemPrompt.includes("Do not explain why a step works."));
  assert.ok(promptBundle.systemPrompt.includes("Action fields must contain direct imperative instructions only."));
  assert.ok(promptBundle.userPrompt.includes("Every action must be direct command text only"));
  assert.ok(promptBundle.userPrompt.includes("Every caution must be one short safety command only"));
});

test("planner subagent reruns pipeline after first parse failure", async () => {
  let callCount = 0;

  const fakeOpenAI = {
    responses: {
      create: async () => {
        callCount += 1;

        if (callCount === 1) {
          return {
            output_text: "not-json"
          };
        }

        return {
          output_text: JSON.stringify({
            title: "Retweaked Plan",
            simpleSummary: "Conformed after retry.",
            prepPaths: {
              tools: { best: "best", hack: "hack" },
              budget: { best: "best", hack: "hack" }
            },
            partsNeeded: ["Multimeter"],
            toolSuggestions: ["Use leverage"],
            steps: [
              {
                id: "step_1",
                title: "Inspect thermal fuse",
                action: "Test continuity.",
                alternateAction: "Use visible inspection path.",
                whyImportant: "Common failure point.",
                caution: "Unplug first.",
                doneCheck: "Continuity known.",
                fallbackAction: "Move to thermostat.",
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

  assert.equal(callCount, 2);
  assert.equal(result.title, "Retweaked Plan");
  assert.equal(result.steps.length, 1);
});

test("planner subagent enforces stage-2 compliance repair before any rerun", async () => {
  let callCount = 0;

  const fakeOpenAI = {
    responses: {
      create: async () => {
        callCount += 1;

        return {
          output_text: JSON.stringify({
            title: "Needs repair pass",
            simpleSummary: "Initial content can be repaired.",
            prepPaths: {
              tools: { best: "best", hack: "hack" },
              budget: { best: "best", hack: "hack" }
            },
            partsNeeded: ["Multimeter"],
            toolSuggestions: ["Use leverage"],
            steps: [
              {
                id: "dup",
                title: "Step A",
                action: "Check continuity.",
                alternateAction: "Use backup continuity check.",
                whyImportant: "Confirm fault path.",
                caution: "Unplug unit.",
                doneCheck: "Continuity is known.",
                fallbackAction: "Move to thermostat.",
                failedNextId: null,
                tools: ["Multimeter"]
              },
              {
                id: "dup",
                title: "Step B",
                action: "Inspect harness.",
                alternateAction: "Reseat harness.",
                whyImportant: "Confirm connector state.",
                caution: "Power remains off.",
                doneCheck: "Harness is fully seated.",
                fallbackAction: "Move to control board.",
                failedNextId: null,
                tools: ["Screwdriver"]
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

  assert.equal(callCount, 1);
  assert.equal(result.processingMeta.pipelineRunsUsed, 1);
  assert.equal(result.processingMeta.forcedThirdRunAcceptance, false);
  assert.equal(result.steps[0].id, "dup");
  assert.equal(result.steps[1].id, "dup_2");
});

test("planner subagent reruns full pipeline from pass 1 after a failed run", async () => {
  let callCount = 0;

  function makeValidPlan(title) {
    return {
      title,
      simpleSummary: "Conformed plan.",
      prepPaths: {
        tools: { best: "best", hack: "hack" },
        budget: { best: "best", hack: "hack" }
      },
      partsNeeded: ["Multimeter"],
      toolSuggestions: ["Use leverage"],
      steps: [
        {
          id: "step_1",
          title: "Inspect fuse",
          action: "Check fuse continuity.",
          alternateAction: "Inspect visible damage.",
          whyImportant: "Common failure source.",
          caution: "Unplug unit first.",
          doneCheck: "Continuity status known.",
          fallbackAction: "Continue to next step.",
          failedNextId: null,
          tools: ["Multimeter"]
        }
      ]
    };
  }

  const fakeOpenAI = {
    responses: {
      create: async () => {
        callCount += 1;

        if (callCount === 1) {
          return { output_text: "not-json" };
        }

        return { output_text: JSON.stringify(makeValidPlan("Run 2 Success")) };
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

  assert.equal(callCount, 2);
  assert.equal(result.title, "Run 2 Success");
  assert.equal(result.processingMeta.pipelineRunsUsed, 2);
  assert.equal(result.processingMeta.pipelineRunFailures, 1);
  assert.equal(result.processingMeta.forcedThirdRunAcceptance, false);
});

test("planner subagent accepts third run output when unresolved non-hard compliance issues remain", async () => {
  let callCount = 0;

  function makeNonCompliantPlan(runLabel) {
    return {
      title: `Plan ${runLabel}`,
      simpleSummary: "Will parse but fail compliance due to duplicate ids.",
      prepPaths: {
        tools: { best: "best", hack: "hack" },
        budget: { best: "best", hack: "hack" }
      },
      partsNeeded: ["Part A"],
      toolSuggestions: ["Use leverage"],
      steps: [
        {
          id: "dup",
          title: "Step A",
          action: "repeat repeat repeat",
          alternateAction: "Alt A",
          whyImportant: "Why A",
          caution: "Caution A",
          doneCheck: "Done A",
          fallbackAction: "Fallback A",
          failedNextId: null,
          tools: ["Tool A"]
        },
        {
          id: "dup",
          title: "Step B",
          action: "inspect harness",
          alternateAction: "Alt B",
          whyImportant: "Why B",
          caution: "Caution B",
          doneCheck: "Done B",
          fallbackAction: "Fallback B",
          failedNextId: null,
          tools: ["Tool B"]
        }
      ]
    };
  }

  const fakeOpenAI = {
    responses: {
      create: async () => {
        callCount += 1;
        const runIndex = callCount;
        return { output_text: JSON.stringify(makeNonCompliantPlan(`run${runIndex}`)) };
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

  assert.equal(callCount, 3);
  assert.equal(result.processingMeta.pipelineRunsUsed, 3);
  assert.equal(result.processingMeta.pipelineRunFailures, 3);
  assert.equal(result.processingMeta.forcedThirdRunAcceptance, true);
  assert.equal(result.steps.length, 2);
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
  assert.ok(cleaned.steps[0].action.includes("Then check if the issue changes."));
  assert.ok(!cleaned.simpleSummary.toLowerCase().includes("historically"));
  assert.ok(cleaned.toolSuggestions.some((tip) => tip.toLowerCase().includes("leverage")));
});

test("response cleaner removes explanatory reasoning from action and caution lines", () => {
  const dirtyJson = JSON.stringify({
    title: "Dryer Plan",
    simpleSummary: "Do this because it is safer.",
    partsNeeded: ["Multimeter"],
    toolSuggestions: ["Use leverage over force"],
    steps: [
      {
        id: "step_1",
        title: "Safety prep",
        action: "Unplug the dryer because capacitors hold charge.",
        alternateAction: "Turn off the breaker because live voltage may remain.",
        whyImportant: "This step reduces shock risk.",
        caution: "Wear insulated gloves because residual energy might discharge.",
        doneCheck: "Power is off because the display is dark.",
        fallbackAction: "If unsure, verify with a meter because assumptions are risky.",
        tools: ["Multimeter"]
      }
    ]
  });

  const cleaned = cleanAndNormalizeResponse(dirtyJson, {
    intake,
    priorHints: []
  });

  assert.equal(cleaned.steps.length, 1);
  assert.equal(cleaned.steps[0].title, "Safety prep");
  assert.equal(cleaned.steps[0].action, "Unplug the dryer. Then check if the issue changes.");
  assert.equal(cleaned.steps[0].alternateAction, "Turn off the breaker.");
  assert.equal(cleaned.steps[0].caution, "Wear insulated gloves.");
  assert.equal(cleaned.steps[0].doneCheck, "Power is off.");
  assert.equal(cleaned.steps[0].fallbackAction, "If unsure, check with a meter.");
  assert.equal(cleaned.steps[0].whyImportant, "Isolate one variable before moving to the next check.");
});
