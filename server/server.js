import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import OpenAI from "openai";
import { z } from "zod";
import { createSelfMemoryStore } from "./modules/selfMemory.js";
import { createStepMetricsStore } from "./modules/stepMetrics.js";
import { getRuntimeConfigPath, loadRuntimeConfig, resolveActiveModeConfig } from "./modules/runtimeConfig.js";
import { createRequestThrottle } from "./modules/requestThrottle.js";
import { createConformStatsStore } from "./modules/conformStats.js";
import { createRequestHistoryLogger } from "./modules/requestHistoryLogger.js";
import { processRepairPlanRequest } from "./ai-processing/repairPlanProcessor.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const runtimeConfig = loadRuntimeConfig();
const { mode, modeOptions, modeConfig } = resolveActiveModeConfig(runtimeConfig);
const requiredModelByMode = {
  SubagentMode: "gpt-4.1-mini",
  UserMode: "gpt-5-mini"
};
const activeModel = modeConfig?.lowCostModel || requiredModelByMode[mode] || "gpt-5-mini";
const plannerPath = modeConfig?.plannerPath || "agent-run-subagent";
const configuredLowCostModel = modeConfig?.lowCostModel || activeModel;
// UserMode is pinned to gpt-5-mini regardless of runtime config overrides.
const lowCostModel = mode === "UserMode" ? requiredModelByMode.UserMode : configuredLowCostModel;
const runModeSettings = {
  promptCooldownSeconds: Number(runtimeConfig.runModeSettings?.promptCooldownSeconds || 20),
  safetyBlockingEnabled: runtimeConfig.runModeSettings?.safetyBlockingEnabled !== false,
  normalizeCodeToText: runtimeConfig.runModeSettings?.normalizeCodeToText !== false,
  keepUserHistory: runtimeConfig.runModeSettings?.keepUserHistory === true,
  historyLogFile: String(runtimeConfig.runModeSettings?.historyLogFile || "data/requestHistory.jsonl").trim(),
  plannerTimeoutMs: Math.max(10000, Number(runtimeConfig.runModeSettings?.plannerTimeoutMs || 30000)),
  searchVerifierTimeoutMs: Math.max(3000, Number(runtimeConfig.runModeSettings?.searchVerifierTimeoutMs || 8000))
};
const promptThrottle = createRequestThrottle({ cooldownSeconds: runModeSettings.promptCooldownSeconds });

const API_KEY_CANDIDATES = [
  "OPENAI_API_KEY",
  "CHATGPT_API_KEY",
  "OPENAI_KEY",
  "NAI_API_KEY",
  "GPT_API_KEY"
];

function buildApiKeyCandidateList(config) {
  const configuredName = typeof config?.runModeSettings?.apiKeyEnvVar === "string"
    ? config.runModeSettings.apiKeyEnvVar.trim()
    : "";

  const discoveredNames = Object.keys(process.env).filter((name) => {
    const hasProviderHint = /(OPEN.?AI|CHAT.?GPT|GPT|NAI)/i.test(name);
    const hasSecretHint = /(KEY|TOKEN)/i.test(name);
    return hasProviderHint && hasSecretHint;
  });

  return [...new Set([
    ...(configuredName ? [configuredName] : []),
    ...API_KEY_CANDIDATES,
    ...discoveredNames
  ])];
}

function resolveApiKey(candidateList) {
  for (const keyName of candidateList) {
    const value = process.env[keyName];
    if (typeof value === "string" && value.trim().length > 0) {
      return {
        keyName,
        apiKey: value.trim()
      };
    }
  }

  return {
    keyName: null,
    apiKey: ""
  };
}

const apiKeyCandidateList = buildApiKeyCandidateList(runtimeConfig);
const apiKeyResolution = resolveApiKey(apiKeyCandidateList);

const openai = apiKeyResolution.apiKey
  ? new OpenAI({
      apiKey: apiKeyResolution.apiKey
    })
  : null;

const memoryStore = createSelfMemoryStore();
const metricsStore = createStepMetricsStore();
const conformStatsStore = createConformStatsStore();
const requestHistoryLogger = createRequestHistoryLogger({
  enabled: runModeSettings.keepUserHistory,
  filePath: runModeSettings.historyLogFile
});

await Promise.all([memoryStore.load(), metricsStore.load(), conformStatsStore.load()]);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

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
    requiredModelByMode,
    runModeSettings,
    apiKeyConfiguredFrom: apiKeyResolution.keyName,
    apiKeyCandidateList,
    runtimeConfigPath: getRuntimeConfigPath()
  });
});

app.post("/api/repair-plan", async (request, response) => {
  const result = await processRepairPlanRequest({
    body: request.body,
    requestIp: request.ip,
    openaiClient: openai,
    runModeSettings,
    modeConfig,
    lowCostModel,
    plannerPath,
    mode,
    promptThrottle,
    memoryStore,
    metricsStore,
    conformStatsStore,
    requestHistoryLogger,
    apiKeyCandidateList
  });

  if (result.headers) {
    for (const [header, value] of Object.entries(result.headers)) {
      response.set(header, value);
    }
  }

  return response.status(result.status).json(result.body);
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
  response.json({
    ...metricsStore.summary(),
    conformStats: conformStatsStore.summary()
  });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Fixityerself backend listening on port ${port}`);
});
