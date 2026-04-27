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

const REASONING_MARKERS = [
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

const DUMMY_STEP_TITLE = "things to check first";

const JUNIOR_HIGH_REPLACEMENTS = [
  [/\butilize\b/gi, "use"],
  [/\bapproximately\b/gi, "about"],
  [/\bverify\b/gi, "check"],
  [/\badditional\b/gi, "more"],
  [/\bprior\b/gi, "earlier"],
  [/\bproceed\b/gi, "go"],
  [/\bcommence\b/gi, "start"],
  [/\bterminate\b/gi, "stop"],
  [/\bensure\b/gi, "make sure"],
  [/\bisolate\b/gi, "separate"],
  [/\bcomponent\b/gi, "part"],
  [/\bdiagnostic\b/gi, "check"],
  [/\bdetermine\b/gi, "find"],
  [/\bsufficient\b/gi, "enough"],
  [/\bsubsystem\b/gi, "part"],
  [/\bmalfunction\b/gi, "problem"]
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

function limitSentenceCount(value, maxSentences = 2) {
  const text = sanitizeLine(value);
  if (!text) {
    return "";
  }

  const parts = text.match(/[^.!?]+[.!?]?/g) || [text];
  const trimmed = parts.map((item) => item.trim()).filter(Boolean);
  return trimmed.slice(0, Math.max(1, maxSentences)).join(" ").trim();
}

function splitSentences(value) {
  const text = sanitizeLine(value);
  if (!text) {
    return [];
  }

  return (text.match(/[^.!?]+[.!?]?/g) || [text])
    .map((item) => item.trim())
    .filter(Boolean);
}

function simplifyToJuniorHighEnglish(value) {
  let text = sanitizeLine(value);
  if (!text) {
    return "";
  }

  for (const [pattern, replacement] of JUNIOR_HIGH_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  return compactWhitespace(text);
}

function looksLikeDummyChecklistTitle(value) {
  return sanitizeLine(value).toLowerCase() === DUMMY_STEP_TITLE;
}

function buildDummyChecklistAction(value) {
  const rawParts = String(value || "")
    .split(/\n|[;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const items = [];
  for (const part of rawParts) {
    const clauses = part
      .split(/[.!?]+/)
      .map((clause) => clause.trim())
      .filter(Boolean);

    for (const clause of clauses) {
      let line = clause.replace(/^\d+\s*[).:-]?\s*/, "");
      line = simplifyToJuniorHighEnglish(truncateAtReasoningMarker(line));
      if (!line || looksLikeNonActionSentence(line)) {
        continue;
      }
      items.push(ensureTrailingPeriod(line));
    }
  }

  const uniqueItems = [...new Set(items)];
  const checklist = uniqueItems;

  if (checklist.length === 0) {
    return "";
  }

  if (checklist.length > 4) {
    const firstThree = checklist.slice(0, 3);
    const mergedTail = checklist
      .slice(3)
      .map((line) => line.replace(/[.!?]$/, ""))
      .join("; ");
    return [...firstThree, ensureTrailingPeriod(mergedTail)]
      .slice(0, 4)
      .map((line, index) => `${index + 1}. ${line}`)
      .join("\n");
  }

  return checklist
    .slice(0, 4)
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");
}

function truncateAtReasoningMarker(value) {
  let text = sanitizeLine(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return "";
  }

  for (const marker of REASONING_MARKERS) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    const matchIndex = text.search(regex);
    if (matchIndex > 0) {
      text = text.slice(0, matchIndex).trim();
    }
  }

  return text.replace(/[,:;\-]+$/g, "").trim();
}

function looksLikeNonActionSentence(value) {
  const lower = sanitizeLine(value).toLowerCase();
  if (!lower) {
    return true;
  }

  if (NON_ACTION_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }

  return REASONING_MARKERS.some((marker) => lower.includes(marker));
}

function normalizeActionLine(value, maxSentences = 2, requireTwoSentences = false) {
  const bounded = limitSentenceCount(value, maxSentences);
  const truncated = truncateAtReasoningMarker(bounded);
  const compacted = simplifyToJuniorHighEnglish(limitSentenceCount(truncated, maxSentences));

  if (!compacted || looksLikeNonActionSentence(compacted)) {
    return "";
  }

  if (requireTwoSentences) {
    const sentences = splitSentences(compacted).slice(0, 2);
    if (sentences.length === 0) {
      return "";
    }
    if (sentences.length === 1) {
      sentences.push("Then check if the issue changes.");
    }
    return sentences.map((sentence) => ensureTrailingPeriod(sentence)).join(" ");
  }

  return ensureTrailingPeriod(compacted);
}

function ensureTrailingPeriod(value) {
  const text = sanitizeLine(value);
  if (!text) {
    return "";
  }
  return /[.!?]$/.test(text) ? text : `${text}.`;
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
  const seenActionSignatures = new Set();
  const normalized = rawSteps
    .map((entry, index) => {
      const baseTitle = sanitizeLine(entry.title || `Step ${index + 1}`);
      const isDummyChecklist = looksLikeDummyChecklistTitle(baseTitle);
      const title = isDummyChecklist ? DUMMY_STEP_TITLE : baseTitle;
      const actionSource = entry.action || entry.instruction || entry.step || title;
      const action = isDummyChecklist
        ? buildDummyChecklistAction(actionSource)
        : normalizeActionLine(actionSource, 2, true);

      const signature = action
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (!signature || seenActionSignatures.has(signature)) {
        return null;
      }
      seenActionSignatures.add(signature);

      return {
        id: sanitizeLine(entry.id || `step_${index + 1}`),
        title,
        action,
        alternateAction:
          normalizeActionLine(entry.alternateAction || entry.altAction || entry.fallbackAction || entry.ifFail, 2) ||
          "Use the lower-cost or workaround route for this step.",
        whyImportant:
          normalizeActionLine(entry.whyImportant || entry.why, 1) ||
          "Isolate one variable before moving to the next check.",
        caution:
          normalizeActionLine(entry.caution || entry.safety, 1) ||
          "Disconnect power and isolate fluid or gas paths before contact.",
        doneCheck:
          normalizeActionLine(entry.doneCheck || entry.successCriteria, 1) ||
          "The symptom clearly improves after this step.",
        fallbackAction:
          normalizeActionLine(entry.fallbackAction || entry.ifFail, 2) ||
          "If this fails, continue to the next targeted diagnostic step.",
        failedNextId: entry.failedNextId || entry.next?.failed || null,
        tools: ensureArray(entry.tools || entry.requiredTools)
      };
    })
    .filter(Boolean)
    .filter((step) => step.action);

  return normalized.slice(0, 10);
}

function deriveToolSuggestions(steps, rawTips) {
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

  if (merged.size === 0) {
    merged.add("Use leverage, not brute force, on tight fasteners.");
    merged.add("Hold a wrench near the end for better torque and control.");
  }

  return [...merged].slice(0, 12);
}

function normalizePrepPaths(prepPaths) {
  const toolsBest = simplifyToJuniorHighEnglish(prepPaths?.tools?.best) || "Best path: use the full recommended tool kit first.";
  const toolsHack = simplifyToJuniorHighEnglish(prepPaths?.tools?.hack) || "Hack path: use safe substitute tools and cleanup-first methods.";
  const budgetBest = simplifyToJuniorHighEnglish(prepPaths?.budget?.best) || "Best path budget: prioritize reliability-first spend.";
  const budgetHack = simplifyToJuniorHighEnglish(prepPaths?.budget?.hack) || "Hack path budget: prioritize low-cost workaround methods first.";

  return {
    tools: {
      best: toolsBest,
      hack: toolsHack
    },
    budget: {
      best: budgetBest,
      hack: budgetHack
    }
  };
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
    simplifyToJuniorHighEnglish(dropLowSignalSentence(parsed.simpleSummary)) ||
    `Focused plan for ${context.intake?.deviceType || "device"}: ${sanitizeLine(context.intake?.symptom || "repair issue")}.`;

  const partsNeeded = ensureArray(parsed.partsNeeded).slice(0, 12);
  const toolSuggestions = deriveToolSuggestions(steps, parsed.toolSuggestions);
  const prepPaths = normalizePrepPaths(parsed.prepPaths);

  return {
    title,
    simpleSummary,
    partsNeeded,
    toolSuggestions,
    prepPaths,
    steps
  };
}
