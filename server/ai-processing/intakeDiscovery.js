const DEVICE_HINTS = [
  { device: "Dryer", patterns: [/\bdryer\b/i, /\bclothes (stay wet|not dry|won't dry|wont dry)\b/i, /\bno heat\b/i] },
  { device: "Washer", patterns: [/\bwasher\b/i, /\bwon't spin\b/i, /\bwon't drain\b/i, /\bleak\b/i] },
  { device: "Refrigerator", patterns: [/\bfridge\b/i, /\brefrigerator\b/i, /\bnot cooling\b/i] },
  { device: "Dishwasher", patterns: [/\bdishwasher\b/i, /\bnot cleaning\b/i, /\bdoesn't drain\b/i] },
  { device: "Oven", patterns: [/\boven\b/i, /\bnot heating\b/i, /\bbake\b/i] }
];

const ERROR_CODE_REGEX = /\b([A-Z]{1,3}\d{1,4})\b/g;

export function discoverInputContext(intake) {
  const textCorpus = [
    intake.repairGoal,
    intake.deviceType,
    intake.symptom,
    intake.exactWhen,
    intake.soundSmell,
    intake.errorCodes,
    intake.attemptedFixes
  ]
    .filter(Boolean)
    .join(" ");

  const deviceHints = DEVICE_HINTS
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(textCorpus)))
    .map((entry) => entry.device);

  const extractedCodes = [];
  const matches = textCorpus.matchAll(ERROR_CODE_REGEX);
  for (const match of matches) {
    if (match[1]) {
      extractedCodes.push(match[1]);
    }
  }

  const uniqueCodes = [...new Set(extractedCodes)];

  const missingRecommended = [];
  if (!String(intake.exactWhen || "").trim()) {
    missingRecommended.push("exactWhen");
  }
  if (!String(intake.availableTools || "").trim()) {
    missingRecommended.push("availableTools");
  }
  if (!String(intake.attemptedFixes || "").trim()) {
    missingRecommended.push("attemptedFixes");
  }

  return {
    discoveredDeviceHints: deviceHints,
    extractedErrorCodes: uniqueCodes,
    missingRecommended,
    inferredQualityScore: Math.max(0, 100 - missingRecommended.length * 15)
  };
}
