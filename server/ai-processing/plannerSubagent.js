import { cleanAndNormalizeResponse } from "./responseCleaner.js";
import {
  attemptConformComplianceRepair,
  buildComplianceIssueText,
  evaluateConformCompliance
} from "./conformCompliance.js";

// Hard cap requested: three compliance attempts total.
const MAX_PIPELINE_RUNS = 3;

const REPAIR_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "simpleSummary", "partsNeeded", "toolSuggestions", "prepPaths", "steps"],
  properties: {
    title: { type: "string", maxLength: 90 },
    simpleSummary: { type: "string", maxLength: 260 },
    partsNeeded: {
      type: "array",
      items: { type: "string", maxLength: 80 },
      maxItems: 12
    },
    toolSuggestions: {
      type: "array",
      items: { type: "string", maxLength: 120 },
      maxItems: 12
    },
    prepPaths: {
      type: "object",
      additionalProperties: false,
      required: ["tools", "budget"],
      properties: {
        tools: {
          type: "object",
          additionalProperties: false,
          required: ["best", "hack"],
          properties: {
            best: { type: "string", maxLength: 180 },
            hack: { type: "string", maxLength: 180 }
          }
        },
        budget: {
          type: "object",
          additionalProperties: false,
          required: ["best", "hack"],
          properties: {
            best: { type: "string", maxLength: 140 },
            hack: { type: "string", maxLength: 140 }
          }
        }
      }
    },
    steps: {
      type: "array",
      minItems: 4,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "title",
          "action",
          "alternateAction",
          "whyImportant",
          "caution",
          "doneCheck",
          "fallbackAction",
          "failedNextId",
          "tools"
        ],
        properties: {
          id: { type: "string", maxLength: 40 },
          title: { type: "string", maxLength: 90 },
          action: { type: "string", maxLength: 220 },
          alternateAction: { type: "string", maxLength: 220 },
          whyImportant: { type: "string", maxLength: 180 },
          caution: { type: "string", maxLength: 180 },
          doneCheck: { type: "string", maxLength: 160 },
          fallbackAction: { type: "string", maxLength: 180 },
          failedNextId: {
            anyOf: [
              { type: "string", maxLength: 40 },
              { type: "null" }
            ]
          },
          tools: {
            type: "array",
            items: { type: "string", maxLength: 60 },
            maxItems: 8
          }
        }
      }
    }
  }
};

function buildContentSystemPrompt() {
  return [
    "You are a home-repair workflow planner.",
    "Return strict final JSON only.",
    "Use high-signal technical steps and branch options.",
    "Avoid filler or repeated looped actions.",
    "Each step action must be distinct and concrete."
  ].join("\n");
}

function hasHardActionOnlyGateViolations(issues) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return false;
  }

  return issues.some((issue) => String(issue || "").includes("contains non-action reasoning that is hard-blocked"));
}

function buildContentUserPrompt(userPrompt, runIndex, previousIssues) {
  const sections = [
    `Pipeline run ${runIndex} of ${MAX_PIPELINE_RUNS}.`,
    "Generate complete actionable content with strong branch coverage in one pass.",
    "Original intake prompt:",
    userPrompt
  ];

  if (Array.isArray(previousIssues) && previousIssues.length > 0) {
    sections.push(
      "Previous pipeline run failed compliance. Resolve these weaknesses in this new content draft:",
      buildComplianceIssueText(previousIssues)
    );
  }

  return sections.join("\n\n");
}

async function callModel(openaiClient, model, systemText, userText) {
  const lowerModel = String(model || "").toLowerCase();
  const supportsTemperature = !lowerModel.startsWith("gpt-5");
  const request = {
    model,
    max_output_tokens: 2600,
    text: {
      format: {
        type: "json_schema",
        name: "repair_plan",
        strict: true,
        schema: REPAIR_PLAN_JSON_SCHEMA
      }
    },
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemText }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userText }]
      }
    ]
  };

  if (supportsTemperature) {
    request.temperature = 0.2;
  }

  if (lowerModel.startsWith("gpt-5")) {
    request.reasoning = { effort: "minimal" };
  }

  return openaiClient.responses.create(request);
}

async function runSinglePipeline({
  openaiClient,
  lowCostModel,
  promptBundle,
  intake,
  runIndex,
  previousIssues,
  onHistoryEvent
}) {
  const systemText = [
    buildContentSystemPrompt(),
    "Required schema and constraints:",
    promptBundle.systemPrompt
  ].join("\n\n");
  const userText = buildContentUserPrompt(promptBundle.userPrompt, runIndex, previousIssues);

  await onHistoryEvent?.({
    stage: "run.request",
    runIndex,
    model: lowCostModel,
    systemPrompt: systemText,
    userPrompt: userText,
    formatPrompting: Array.isArray(previousIssues) ? previousIssues : []
  });

  const modelResult = await callModel(openaiClient, lowCostModel, systemText, userText);
  const rawOutput = modelResult.output_text || "";

  await onHistoryEvent?.({
    stage: "run.raw_response",
    runIndex,
    model: lowCostModel,
    responseText: rawOutput
  });

  let plan = null;
  let compliance = { ok: false, issues: ["Unknown conform failure"] };
  let formatAttemptsUsed = 1;

  try {
    plan = cleanAndNormalizeResponse(rawOutput, {
      intake,
      model: lowCostModel
    });

    await onHistoryEvent?.({
      stage: "run.cleaned_output",
      runIndex,
      cleanedPlan: plan
    });

    const firstCompliance = evaluateConformCompliance(plan);

    await onHistoryEvent?.({
      stage: "run.compliance_check",
      runIndex,
      compliance: firstCompliance
    });

    compliance = firstCompliance;

    // Stage 2 is mandatory for every run: repair toward compliance before considering fallback runs.
    if (!compliance.ok && plan) {
      const issuesBeforeRepair = Array.isArray(compliance.issues) ? compliance.issues : [];
      plan = attemptConformComplianceRepair(plan);
      formatAttemptsUsed = 2;
      compliance = evaluateConformCompliance(plan);

      await onHistoryEvent?.({
        stage: "run.compliance_repair",
        runIndex,
        complianceIssues: issuesBeforeRepair,
        repairedPlan: plan,
        repairedCompliance: compliance
      });
    }

    await onHistoryEvent?.({
      stage: "run.finalized_output",
      runIndex,
      finalPlan: plan,
      finalCompliance: compliance,
      formatAttemptsUsed
    });
  } catch (error) {
    compliance = {
      ok: false,
      issues: [
        `Normalizer failure: ${error instanceof Error ? error.message : "Unknown normalizer failure"}`
      ]
    };

    await onHistoryEvent?.({
      stage: "run.cleaner_error",
      runIndex,
      error: error instanceof Error ? error.message : String(error || "Unknown error")
    });
  }

  if (compliance.ok && plan) {
    return {
      ok: true,
      plan,
      runIndex,
      formatAttemptsUsed,
      retryIssues: []
    };
  }

  return {
    ok: false,
    plan,
    runIndex,
    formatAttemptsUsed,
    retryIssues: Array.isArray(compliance.issues) && compliance.issues.length > 0
      ? compliance.issues
      : ["Unknown conform failure"]
  };
}

/**
 * Low-cost planning subagent backed by a compact model.
 */
export async function runPlannerSubagent({
  openaiClient,
  lowCostModel,
  promptBundle,
  intake,
  apiKeyCandidateList = [],
  onHistoryEvent
}) {
  if (!openaiClient) {
    return null;
  }

  await onHistoryEvent?.({
    stage: "subagent.start",
    model: lowCostModel,
    runCap: MAX_PIPELINE_RUNS,
    promptInput: {
      intake,
      apiKeyCandidates: Array.isArray(apiKeyCandidateList) ? apiKeyCandidateList.length : 0
    }
  });

  const runSummaries = [];
  let previousIssues = [];

  for (let runIndex = 1; runIndex <= MAX_PIPELINE_RUNS; runIndex += 1) {
    const runResult = await runSinglePipeline({
      openaiClient,
      lowCostModel,
      promptBundle,
      intake,
      runIndex,
      previousIssues,
      onHistoryEvent
    });

    runSummaries.push({
      runIndex,
      ok: runResult.ok,
      formatAttemptsUsed: runResult.formatAttemptsUsed,
      issues: runResult.retryIssues
    });

    if (runResult.ok) {
      if (!runResult.plan.steps || runResult.plan.steps.length === 0) {
        throw new Error("Planner subagent produced no actionable steps.");
      }

      await onHistoryEvent?.({
        stage: "subagent.success",
        runIndex,
        runSummaries,
        acceptedPlan: runResult.plan
      });

      return {
        ...runResult.plan,
        processingMeta: {
          pipelineRunsUsed: runIndex,
          pipelineRunFailures: runIndex - 1,
          forcedThirdRunAcceptance: false,
          runSummaries
        }
      };
    }

    previousIssues = runResult.retryIssues;

    if (runIndex === MAX_PIPELINE_RUNS && runResult.plan) {
      if (hasHardActionOnlyGateViolations(runResult.retryIssues)) {
        throw new Error(
          `Output hard-gate compliance failed after all pipeline runs. ${buildComplianceIssueText(runResult.retryIssues)}`
        );
      }

      if (!runResult.plan.steps || runResult.plan.steps.length === 0) {
        throw new Error("Planner subagent produced no actionable steps on final pipeline run.");
      }

      await onHistoryEvent?.({
        stage: "subagent.forced_accept",
        runIndex,
        runSummaries,
        acceptedPlan: runResult.plan,
        finalIssues: runResult.retryIssues
      });

      return {
        ...runResult.plan,
        processingMeta: {
          pipelineRunsUsed: MAX_PIPELINE_RUNS,
          pipelineRunFailures: MAX_PIPELINE_RUNS,
          forcedThirdRunAcceptance: true,
          runSummaries
        }
      };
    }
  }

  throw new Error(`Output conform compliance failed after all pipeline runs. ${buildComplianceIssueText(previousIssues)}`);
}
