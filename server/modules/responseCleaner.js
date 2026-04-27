const LOW_SIGNAL_TERMS = [
  "history",
  "historically",
  "generally",
  "in general",
  "overview",
  "background",
  "typically",
  "for decades"
];

function compactWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeLine(value) {
  const cleaned = compactWhitespace(value)
    .replace(/^certainly[,:]?\s*/i, "")
    .replace(/^here('?s| is)\s+/i, "")
    .replace(/^based on your description[,:]?\s*/i, "");

  return cleaned;
}

function dropLowSignalSentence(value) {
  const text = sanitizeLine(value);
  if (!text) {
    return "";
  }

  const lower = text.toLowerCase();
  const containsLowSignal = LOW_SIGNAL_TERMS.some((term) => lower.includes(term));

  if (!containsLowSignal) {
    return text;
  }

  // Keep detail-heavy lines even if they include low-signal terms.
  if (/\d/.test(text) || /\b(voltage|ohm|hose|valve|breaker|connector|wrench|torque|filter)\b/i.test(text)) {
    return text;
  }

  return "";
}

function ensureArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeLine(item))
      .filter(Boolean);
  }

  if (!value) {
    return [];
  }

  return String(value)
    .split(/\n|,|;/)
    .map((item) => sanitizeLine(item))
    .filter(Boolean);
}

function extractJson(rawText) {
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    const candidate = rawText.slice(start, end + 1);

    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

function normalizeSteps(rawSteps) {
  const normalized = rawSteps
    .map((entry, index) => {
      const title = sanitizeLine(entry.title || `Step ${index + 1}`);
      const action = sanitizeLine(entry.action || entry.instruction || entry.step || title);

      return {
        id: sanitizeLine(entry.id || `step_${index + 1}`),
        title,
        action,
        whyImportant:
          dropLowSignalSentence(entry.whyImportant || entry.why) ||
          "This reduces uncertainty by validating one subsystem at a time.",
        caution:
          sanitizeLine(entry.caution || entry.safety) ||
          "Disconnect power and isolate fluid or gas paths before contact.",
        doneCheck:
          sanitizeLine(entry.doneCheck || entry.successCriteria) ||
          "The symptom clearly improves after this step.",
        fallbackAction:
          sanitizeLine(entry.fallbackAction || entry.ifFail) ||
          "If this fails, continue to the next targeted diagnostic step.",
        failedNextId: entry.failedNextId || entry.next?.failed || null,
        tools: ensureArray(entry.tools || entry.requiredTools)
      };
    })
    .filter((step) => step.action);

  return normalized.slice(0, 10);
}

function deriveToolSuggestions(steps, rawTips, priorHints) {
  const merged = new Set();

  for (const tip of ensureArray(rawTips)) {
    const cleaned = dropLowSignalSentence(tip);
    if (cleaned) {
      merged.add(cleaned);
    }
  }

  for (const step of steps) {
    for (const tool of step.tools) {
      merged.add(`Use ${tool} only for this step, then verify result before changing another variable.`);
    }
  }

  for (const hint of priorHints || []) {
    if (hint) {
      merged.add(hint);
    }
  }

  if (merged.size === 0) {
    merged.add("Use leverage, not brute force, on tight fasteners.");
    merged.add("Hold a wrench near the end for better torque and control.");
  }

  return [...merged].slice(0, 12);
}

export function cleanAndNormalizeResponse(rawText, context = {}) {
  const parsed = extractJson(rawText);

  if (!parsed) {
    throw new Error("Model output was not valid JSON.");
  }

  const steps = normalizeSteps(Array.isArray(parsed.steps) ? parsed.steps : []);

  if (steps.length === 0) {
    throw new Error("JSON parsed but no valid steps remained after cleanup.");
  }

  const title = sanitizeLine(parsed.title || `${context.intake?.deviceType || "Repair"} Plan`);
  const simpleSummary =
    dropLowSignalSentence(parsed.simpleSummary) ||
    `Focused plan for ${context.intake?.deviceType || "device"}: ${sanitizeLine(context.intake?.symptom || "repair issue")}.`;

  const partsNeeded = ensureArray(parsed.partsNeeded).slice(0, 12);
  const toolSuggestions = deriveToolSuggestions(steps, parsed.toolSuggestions, context.priorHints || []);

  return {
    title,
    simpleSummary,
    partsNeeded,
    toolSuggestions,
    steps
  };
}
