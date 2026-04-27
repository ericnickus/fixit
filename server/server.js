import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { z } from "zod";
import { buildPromptBundle } from "./modules/promptBuilder.js";
import { buildMockPlan } from "./modules/mockPlan.js";
import { createSelfMemoryStore } from "./modules/selfMemory.js";
import { createStepMetricsStore } from "./modules/stepMetrics.js";
import { runPlannerSubagent } from "./modules/plannerSubagent.js";
import { runSearchVerifierSubagent } from "./modules/searchVerifierSubagent.js";
import { getRuntimeConfigPath, loadRuntimeConfig, resolveActiveModeConfig } from "./modules/runtimeConfig.js";
import { checkPromptSafety, normalizeIntakeToPlainText } from "./modules/promptSafety.js";
import { createRequestThrottle } from "./modules/requestThrottle.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const runtimeConfig = loadRuntimeConfig();
const { mode, modeOptions, modeConfig } = resolveActiveModeConfig(runtimeConfig);
const requiredPlannerPath = "agent-run-subagent";
const requiredModelByMode = {
  selfTest: "gpt-4.1-mini",
  UserMode: "gpt-5-mini"
};
const requiredSubagentModel = requiredModelByMode[mode] || "gpt-4.1-mini";
const plannerPath = modeConfig?.plannerPath || requiredPlannerPath;
const configuredLowCostModel =
  process.env.OPENAI_LOW_COST_MODEL || modeConfig?.lowCostModel || requiredSubagentModel;
const lowCostModel = requiredSubagentModel;
const strictSubagent = modeConfig?.strictSubagent !== false;
const allowMockFallback = modeConfig?.allowMockFallback === true;
const runModeSettings = {
  promptCooldownSeconds: Number(runtimeConfig.runModeSettings?.promptCooldownSeconds || 20),
  safetyBlockingEnabled: runtimeConfig.runModeSettings?.safetyBlockingEnabled !== false,
  normalizeCodeToText: runtimeConfig.runModeSettings?.normalizeCodeToText !== false
};
const promptThrottle = createRequestThrottle({ cooldownSeconds: runModeSettings.promptCooldownSeconds });

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

const memoryStore = createSelfMemoryStore();
const metricsStore = createStepMetricsStore();

await Promise.all([memoryStore.load(), metricsStore.load()]);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const IntakeSchema = z.object({
  repairGoal: z.string().min(1),
  deviceType: z.string().min(1),
  brand: z.string().optional().default(""),
  model: z.string().optional().default(""),
  ageYears: z.string().optional().default(""),
  symptom: z.string().min(1),
  exactWhen: z.string().optional().default(""),
  soundSmell: z.string().optional().default(""),
  errorCodes: z.string().optional().default(""),
  attemptedFixes: z.string().optional().default(""),
  availableTools: z.string().optional().default(""),
  confidenceLevel: z.string().optional().default("Beginner"),
  safetyConcerns: z.string().optional().default(""),
  locationSetup: z.string().optional().default(""),
  budgetBand: z.string().optional().default(""),
  urgency: z.string().optional().default("Normal"),
  constraints: z.string().optional().default(""),
  issueFingerprint: z.string().optional().default(""),
  sessionId: z.string().optional().default("")
});

const StepEventSchema = z.object({
  sessionId: z.string().min(1),
  issueFingerprint: z.string().optional().default(""),
  stepId: z.string().min(1),
  stepTitle: z.string().min(1),
  stepIndex: z.number().int().min(0),
  outcome: z.enum(["done", "failed"]),
  timestamp: z.string().optional().default("")
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    mode,
    modeOptions,
    model,
    usingOpenAI: Boolean(openai),
    plannerPath,
    lowCostModel,
    configuredLowCostModel,
    strictSubagent,
    allowMockFallback,
    requiredPlannerPath,
    requiredSubagentModel,
    runModeSettings,
    runtimeConfigPath: getRuntimeConfigPath()
  });
});

app.post("/api/repair-plan", async (request, response) => {
  const parsed = IntakeSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "Invalid intake payload",
      details: parsed.error.flatten()
    });
  }

  const intake = runModeSettings.normalizeCodeToText
    ? normalizeIntakeToPlainText(parsed.data)
    : parsed.data;
  const issueFingerprint = intake.issueFingerprint || `${intake.deviceType}|${intake.symptom}`;

  if (runModeSettings.safetyBlockingEnabled) {
    const safetyResult = checkPromptSafety(intake);
    if (!safetyResult.ok) {
      return response.status(400).json({
        error: "Input blocked by safety policy.",
        blockId: safetyResult.blockId,
        reason: safetyResult.reason
      });
    }
  }

  const throttleKey = intake.sessionId
    ? `session:${intake.sessionId}`
    : `ip:${request.ip || "unknown"}`;
  const throttleResult = promptThrottle.checkAndMark(throttleKey);
  if (!throttleResult.allowed) {
    response.set("Retry-After", String(throttleResult.retryAfterSeconds));
    return response.status(429).json({
      error: "Prompt rate limit exceeded. Wait before sending another prompt.",
      retryAfterSeconds: throttleResult.retryAfterSeconds,
      throttleSeconds: runModeSettings.promptCooldownSeconds
    });
  }

  const priorHints = memoryStore.getTopToolHints(8);
  const promptBundle = buildPromptBundle(intake, priorHints);

  if (strictSubagent && plannerPath !== requiredPlannerPath) {
    return response.status(500).json({
      error: "Invalid planner configuration. plannerPath must be agent-run-subagent.",
      plannerPath,
      requiredPlannerPath
    });
  }

  if (strictSubagent && configuredLowCostModel !== requiredSubagentModel) {
    return response.status(500).json({
      error: `Invalid model configuration. lowCostModel must be ${requiredSubagentModel}.`,
      lowCostModel: configuredLowCostModel,
      requiredSubagentModel
    });
  }

  try {
    let plan;

    if (!openai && allowMockFallback) {
      plan = buildMockPlan(intake, {
        reason: "OPENAI_API_KEY is not configured, fallback allowed by config."
      });
    } else if (!openai) {
      return response.status(503).json({
        error: "OPENAI_API_KEY is required for strict subagent generation.",
        plannerPath,
        lowCostModel,
        strictSubagent
      });
    } else if (plannerPath === requiredPlannerPath) {
      plan = await runPlannerSubagent({
        openaiClient: openai,
        lowCostModel,
        promptBundle,
        intake,
        priorHints
      });
    } else {
      throw new Error("Unsupported planner path. Strict mode requires agent-run-subagent.");
    }

    const userScores = metricsStore.getScoresForPlan(issueFingerprint, plan.steps);
    const userScoreMap = new Map(userScores.map((entry) => [entry.stepId, entry]));

    let resultScores = [];
    if (modeConfig?.enableSearchVerifier) {
      resultScores = await runSearchVerifierSubagent({
        intake,
        steps: plan.steps
      });
    }
    const resultScoreMap = new Map(resultScores.map((entry) => [entry.stepId, entry]));

    plan.steps = plan.steps.map((step) => {
      const userScoreData = userScoreMap.get(step.id);
      const resultScoreData = resultScoreMap.get(step.id);
      const userScore = userScoreData?.userScore ?? 50;
      const resultScore = Number(((resultScoreData?.resultScore ?? 0.5) * 100).toFixed(1));
      const combinedScore = Number((userScore * 0.6 + resultScore * 0.4).toFixed(1));

      let scoreBand = "medium";
      if (combinedScore >= 75) {
        scoreBand = "high";
      } else if (combinedScore < 45) {
        scoreBand = "low";
      }

      return {
        ...step,
        userScore,
        resultScore,
        combinedScore,
        scoreBand,
        resultEvidence: resultScoreData?.evidence || []
      };
    });

    memoryStore.rememberIssue(issueFingerprint);
    memoryStore.absorbPlan(plan);

    response.json({
      ...plan,
      source: openai ? plannerPath : "mock",
      plannerPath,
      mode
    });
  } catch (error) {
    if (!allowMockFallback) {
      return response.status(500).json({
        error: "Subagent generation failed and fallback is disabled.",
        plannerPath,
        lowCostModel,
        mode,
        warning: error instanceof Error ? error.message : "Unknown model error"
      });
    }

    const fallbackPlan = buildMockPlan(intake, {
      reason: "Primary model call failed. Fallback plan generated."
    });

    const userScores = metricsStore.getScoresForPlan(issueFingerprint, fallbackPlan.steps);
    const userScoreMap = new Map(userScores.map((entry) => [entry.stepId, entry]));

    fallbackPlan.steps = fallbackPlan.steps.map((step) => ({
      ...step,
      userScore: userScoreMap.get(step.id)?.userScore ?? 50,
      resultScore: 50,
      combinedScore: 50,
      scoreBand: "medium",
      resultEvidence: ["Search verifier not available in fallback mode."]
    }));

    memoryStore.absorbPlan(fallbackPlan);

    response.status(200).json({
      ...fallbackPlan,
      source: "fallback",
      plannerPath,
      mode,
      warning: error instanceof Error ? error.message : "Unknown model error"
    });
  }
});

app.post("/api/step-event", async (request, response) => {
  const parsed = StepEventSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({
      error: "Invalid step event payload",
      details: parsed.error.flatten()
    });
  }

  const event = parsed.data;
  const snapshot = metricsStore.record(event);

  response.json({
    ok: true,
    viabilitySnapshot: snapshot
  });
});

app.get("/api/metrics", (_request, response) => {
  response.json(metricsStore.summary());
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Fixityerself backend listening on port ${port}`);
});
