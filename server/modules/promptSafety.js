const BLOCK_PATTERNS = [
  {
    id: "weaponization",
    regex: /\b(bomb|explosive|grenade|firearm|gunpowder|silencer|homemade weapon)\b/i,
    reason: "Weapon-related guidance is blocked."
  },
  {
    id: "malware",
    regex: /\b(ransomware|keylogger|malware|phishing kit|ddos|sql injection|exploit)\b/i,
    reason: "Cyberattack or malware content is blocked."
  },
  {
    id: "self_harm",
    regex: /\b(suicide|self-harm|kill myself|overdose)\b/i,
    reason: "Self-harm content requires safety handling and is blocked here."
  },
  {
    id: "violent_harm",
    regex: /\b(poison|assassinate|how to kill|harm someone|make toxic gas)\b/i,
    reason: "Violent harm instructions are blocked."
  }
];

function normalizeText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeIntakeToPlainText(intake) {
  const normalized = { ...intake };

  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === "string") {
      normalized[key] = normalizeText(value);
    }
  }

  return normalized;
}

export function checkPromptSafety(intake) {
  const corpus = Object.values(intake)
    .filter((value) => typeof value === "string")
    .join(" ");

  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.regex.test(corpus)) {
      return {
        ok: false,
        blockId: pattern.id,
        reason: pattern.reason
      };
    }
  }

  return {
    ok: true
  };
}
