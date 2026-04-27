function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const HARD_REASONING_MARKERS = [
  "because",
  "since",
  "therefore",
  "thus",
  "which means",
  "this means",
  "in order to",
  "so that",
  "to avoid",
  "to prevent",
  "the reason",
  "this is why",
  "capacitor holds",
  "capacitors hold",
  "holds charge",
  "stores charge",
  "stores electricity"
];

const NON_ACTION_PREFIXES = [
  "this step",
  "this helps",
  "this prevents",
  "this reduces",
  "this means",
  "the reason",
  "it is important",
  "it helps"
];

function actionSignature(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWordLoop(value) {
  const normalized = actionSignature(value);
  return /(\b\w+\b)(?:\s+\1){2,}/.test(normalized);
}

function containsHardReasoning(value) {
  const normalized = actionSignature(value);
  if (!normalized) {
    return false;
  }

  if (NON_ACTION_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  return HARD_REASONING_MARKERS.some((marker) => normalized.includes(marker));
}

function hasRequiredPrepPaths(plan) {
  return (
    isNonEmptyString(plan?.prepPaths?.tools?.best) &&
    isNonEmptyString(plan?.prepPaths?.tools?.hack) &&
    isNonEmptyString(plan?.prepPaths?.budget?.best) &&
    isNonEmptyString(plan?.prepPaths?.budget?.hack)
  );
}

function toNonEmptyString(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizeStepId(value, index) {
  const base = String(value || `step_${index + 1}`)
    .trim()
    .replace(/\s+/g, "_") || `step_${index + 1}`;
  return base;
}

function validateStep(step, index, issues) {
  const requiredStringFields = [
    "id",
    "title",
    "action",
    "alternateAction",
    "whyImportant",
    "caution",
    "doneCheck",
    "fallbackAction"
  ];

  for (const field of requiredStringFields) {
    if (!isNonEmptyString(step?.[field])) {
      issues.push(`steps[${index}].${field} must be a non-empty string`);
    }
  }

  if (!Array.isArray(step?.tools)) {
    issues.push(`steps[${index}].tools must be an array`);
  }

  if (isNonEmptyString(step?.action) && isWordLoop(step.action)) {
    issues.push(`steps[${index}].action looks repetitive or looped`);
  }

  const actionOnlyFields = ["action", "alternateAction", "fallbackAction", "caution", "doneCheck", "whyImportant"];
  for (const field of actionOnlyFields) {
    if (isNonEmptyString(step?.[field]) && containsHardReasoning(step[field])) {
      issues.push(`steps[${index}].${field} contains non-action reasoning that is hard-blocked`);
    }
  }
}

export function evaluateConformCompliance(plan) {
  const issues = [];

  if (!isNonEmptyString(plan?.title)) {
    issues.push("title must be a non-empty string");
  }

  if (!isNonEmptyString(plan?.simpleSummary)) {
    issues.push("simpleSummary must be a non-empty string");
  }

  if (!Array.isArray(plan?.partsNeeded)) {
    issues.push("partsNeeded must be an array");
  }

  if (!Array.isArray(plan?.toolSuggestions)) {
    issues.push("toolSuggestions must be an array");
  }

  if (!hasRequiredPrepPaths(plan)) {
    issues.push("prepPaths.tools/budget best/hack are required and must be non-empty strings");
  }

  if (!Array.isArray(plan?.steps) || plan.steps.length === 0) {
    issues.push("steps must be a non-empty array");
  } else {
    const seenIds = new Set();
    const seenActionSignatures = new Set();
    for (let i = 0; i < plan.steps.length; i += 1) {
      const step = plan.steps[i];
      validateStep(step, i, issues);
      if (isNonEmptyString(step?.id)) {
        if (seenIds.has(step.id)) {
          issues.push(`steps[${i}].id duplicates a previous step id`);
        }
        seenIds.add(step.id);
      }

      if (isNonEmptyString(step?.action)) {
        const signature = actionSignature(step.action);
        if (signature) {
          if (seenActionSignatures.has(signature)) {
            issues.push(`steps[${i}].action duplicates a previous step action`);
          }
          seenActionSignatures.add(signature);
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function attemptConformComplianceRepair(plan) {
  const repaired = plan && typeof plan === "object"
    ? JSON.parse(JSON.stringify(plan))
    : {};

  repaired.title = toNonEmptyString(repaired.title, "Repair Plan");
  repaired.simpleSummary = toNonEmptyString(repaired.simpleSummary, "Use short direct steps to fix the issue.");
  repaired.partsNeeded = normalizeStringArray(repaired.partsNeeded);
  repaired.toolSuggestions = normalizeStringArray(repaired.toolSuggestions);

  const prepTools = repaired?.prepPaths?.tools || {};
  const prepBudget = repaired?.prepPaths?.budget || {};
  repaired.prepPaths = {
    tools: {
      best: toNonEmptyString(prepTools.best, "Use the standard tool set for this device."),
      hack: toNonEmptyString(prepTools.hack, "Use a safe substitute tool only when needed.")
    },
    budget: {
      best: toNonEmptyString(prepBudget.best, "Prioritize reliable parts first."),
      hack: toNonEmptyString(prepBudget.hack, "Use low-cost alternatives where safe.")
    }
  };

  const rawSteps = Array.isArray(repaired.steps) ? repaired.steps : [];
  repaired.steps = rawSteps.map((rawStep, index) => {
    const step = rawStep && typeof rawStep === "object" ? rawStep : {};

    return {
      id: normalizeStepId(step.id, index),
      title: toNonEmptyString(step.title, `Step ${index + 1}`),
      action: toNonEmptyString(step.action, `Run step ${index + 1}.`),
      alternateAction: toNonEmptyString(step.alternateAction, "Use the alternate method for this step."),
      whyImportant: toNonEmptyString(step.whyImportant, "Confirm one variable before changing another."),
      caution: toNonEmptyString(step.caution, "Disconnect power before contact."),
      doneCheck: toNonEmptyString(step.doneCheck, "The symptom improves after this step."),
      fallbackAction: toNonEmptyString(step.fallbackAction, "Continue to the next step if this fails."),
      failedNextId: step.failedNextId ?? null,
      tools: normalizeStringArray(step.tools)
    };
  });

  const seenIds = new Set();
  repaired.steps = repaired.steps.map((step, index) => {
    let candidate = normalizeStepId(step.id, index);
    let suffix = 2;

    while (seenIds.has(candidate)) {
      candidate = `${normalizeStepId(step.id, index)}_${suffix}`;
      suffix += 1;
    }

    seenIds.add(candidate);
    return {
      ...step,
      id: candidate
    };
  });

  return repaired;
}

export function buildComplianceIssueText(issues) {
  return issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n");
}
