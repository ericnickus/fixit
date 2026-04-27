import { z } from "zod";
import { randomUUID } from "node:crypto";
import { buildPromptBundle } from "./promptBuilder.js";
import { runPlannerSubagent } from "./plannerSubagent.js";
import { runSearchVerifierSubagent } from "./searchVerifierSubagent.js";
import { checkPromptSafety, normalizeIntakeToPlainText } from "./promptSafety.js";
import { discoverInputContext } from "./intakeDiscovery.js";

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
  issueFingerprint: z.string().optional().default(""),
  sessionId: z.string().optional().default("")
}).strict();

function createTimeoutError(message, status = 504) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function withTimeout(taskPromise, timeoutMs, message, status = 504) {
  let timeoutHandle;
  try {
    return await Promise.race([
      taskPromise,
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(createTimeoutError(message, status)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function processRepairPlanRequest({
  body,
  requestIp,
  openaiClient,
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
}) {
  const requestId = randomUUID();

  await requestHistoryLogger?.log({
    requestId,
    stage: "request.received",
    requestIp: requestIp || "unknown",
    payload: body
  });

  const parsed = IntakeSchema.safeParse(body);

  if (!parsed.success) {
    await requestHistoryLogger?.log({
      requestId,
      stage: "request.invalid",
      details: parsed.error.flatten()
    });

    return {
      status: 400,
      body: {
        error: "Invalid intake payload",
        details: parsed.error.flatten()
      }
    };
  }

  const intake = runModeSettings.normalizeCodeToText
    ? normalizeIntakeToPlainText(parsed.data)
    : parsed.data;
  const inputDiscovery = discoverInputContext(intake);
  const enrichedIntake = {
    ...intake,
    discovery: inputDiscovery,
    errorCodes:
      intake.errorCodes ||
      (Array.isArray(inputDiscovery.extractedErrorCodes) && inputDiscovery.extractedErrorCodes.length
        ? inputDiscovery.extractedErrorCodes.join(", ")
        : "")
  };
  const issueFingerprint = enrichedIntake.issueFingerprint || `${enrichedIntake.deviceType}|${enrichedIntake.symptom}`;

  await requestHistoryLogger?.log({
    requestId,
    stage: "request.normalized",
    intake: enrichedIntake,
    inputDiscovery
  });

  if (runModeSettings.safetyBlockingEnabled) {
    const safetyResult = checkPromptSafety(enrichedIntake);
    if (!safetyResult.ok) {
      await requestHistoryLogger?.log({
        requestId,
        stage: "request.safety_blocked",
        safetyResult
      });

      return {
        status: 400,
        body: {
          error: "Input blocked by safety policy.",
          blockId: safetyResult.blockId,
          reason: safetyResult.reason
        }
      };
    }
  }

  const throttleKey = enrichedIntake.sessionId
    ? `session:${enrichedIntake.sessionId}`
    : `ip:${requestIp || "unknown"}`;
  const throttleResult = promptThrottle.checkAndMark(throttleKey);
  if (!throttleResult.allowed) {
    await requestHistoryLogger?.log({
      requestId,
      stage: "request.throttled",
      throttleResult
    });

    return {
      status: 429,
      headers: {
        "Retry-After": String(throttleResult.retryAfterSeconds)
      },
      body: {
        error: "Prompt rate limit exceeded. Wait before sending another prompt.",
        retryAfterSeconds: throttleResult.retryAfterSeconds,
        throttleSeconds: runModeSettings.promptCooldownSeconds
      }
    };
  }

  const priorHints = memoryStore.getTopToolHints(8);
  const promptBundle = buildPromptBundle(enrichedIntake);

  await requestHistoryLogger?.log({
    requestId,
    stage: "prompt.bundle",
    promptInput: {
      intake: enrichedIntake,
      priorHints
    },
    promptBundle
  });

  try {
    if (!openaiClient) {
      await requestHistoryLogger?.log({
        requestId,
        stage: "request.no_key",
        plannerPath,
        lowCostModel,
        mode
      });

      return {
        status: 503,
        body: {
          error: `Runtime generation key is required. Set one of: ${apiKeyCandidateList.join(", ")}.`,
          plannerPath,
          lowCostModel,
          mode
        }
      };
    }

    const plan = await withTimeout(
      runPlannerSubagent({
        openaiClient,
        lowCostModel,
        promptBundle,
        intake: enrichedIntake,
        apiKeyCandidateList,
        onHistoryEvent: async (event) => {
          await requestHistoryLogger?.log({
            requestId,
            ...event,
            stage: `planner.${event.stage}`
          });
        }
      }),
      runModeSettings.plannerTimeoutMs,
      `Planner timed out after ${runModeSettings.plannerTimeoutMs}ms.`,
      504
    );

    await requestHistoryLogger?.log({
      requestId,
      stage: "planner.returned",
      plannerOutput: plan
    });

    const processingMeta = plan.processingMeta || {
      pipelineRunsUsed: 1,
      pipelineRunFailures: 0,
      forcedThirdRunAcceptance: false,
      runSummaries: []
    };

    const conformStats = conformStatsStore.recordRequest({
      pipelineRunFailures: processingMeta.pipelineRunFailures,
      forcedThirdRunAcceptance: processingMeta.forcedThirdRunAcceptance,
      pipelineRunsUsed: processingMeta.pipelineRunsUsed
    });

    const userScores = metricsStore.getScoresForPlan(issueFingerprint, plan.steps);
    const userScoreMap = new Map(userScores.map((entry) => [entry.stepId, entry]));

    let resultScores = [];
    let searchVerifierWarning = "";
    if (modeConfig?.enableSearchVerifier) {
      try {
        resultScores = await withTimeout(
          runSearchVerifierSubagent({
            intake: enrichedIntake,
            steps: plan.steps
          }),
          runModeSettings.searchVerifierTimeoutMs,
          `Search verifier timed out after ${runModeSettings.searchVerifierTimeoutMs}ms.`,
          408
        );
      } catch (searchError) {
        searchVerifierWarning = searchError instanceof Error ? searchError.message : "Search verifier unavailable.";
        await requestHistoryLogger?.log({
          requestId,
          stage: "search_verifier.warning",
          warning: searchVerifierWarning
        });
      }
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

    await requestHistoryLogger?.log({
      requestId,
      stage: "response.machine_formatted",
      processingMeta,
      conformStats,
      searchVerifierWarning,
      finalPlan: plan
    });

    memoryStore.rememberIssue(issueFingerprint);
    memoryStore.absorbPlan(plan);

    return {
      status: 200,
      body: {
        ...plan,
        source: plannerPath,
        plannerPath,
        mode,
        inputDiscovery,
        processingMeta,
        conformStats,
        searchVerifierWarning
      }
    };
  } catch (error) {
    const providerStatus =
      typeof error?.status === "number"
        ? error.status
        : typeof error?.statusCode === "number"
          ? error.statusCode
          : 500;

    const providerMessage = error instanceof Error ? error.message : "Unknown model error";
    const isQuotaOrRateLimit =
      providerStatus === 429 || /quota|rate\s*limit/i.test(providerMessage);

    const topLevelError = isQuotaOrRateLimit
      ? "OpenAI quota/rate limit reached for active model."
      : "Runtime generation failed.";

    await requestHistoryLogger?.log({
      requestId,
      stage: "request.error",
      providerStatus,
      topLevelError,
      warning: providerMessage
    });

    return {
      status: providerStatus,
      body: {
        error: topLevelError,
        plannerPath,
        mode,
        providerStatus,
        warning: providerMessage
      }
    };
  }
}
