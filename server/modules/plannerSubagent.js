import { cleanAndNormalizeResponse } from "./responseCleaner.js";

/**
 * Low-cost planning subagent backed by a compact model.
 */
export async function runPlannerSubagent({ openaiClient, lowCostModel, promptBundle, intake, priorHints }) {
  if (!openaiClient) {
    return null;
  }

  const aiResult = await openaiClient.responses.create({
    model: lowCostModel,
    temperature: 0.2,
    max_output_tokens: 2200,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: promptBundle.systemPrompt }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: promptBundle.userPrompt }]
      }
    ]
  });

  const plan = cleanAndNormalizeResponse(aiResult.output_text, {
    intake,
    model: lowCostModel,
    priorHints
  });

  if (!plan.steps || plan.steps.length === 0) {
    throw new Error("Planner subagent produced no actionable steps.");
  }

  return plan;
}
