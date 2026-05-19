import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootConfigPath = path.resolve(__dirname, "../../fixity.config.json");

const DEFAULT_CONFIG = {
  mode: "UserMode",
  modeOptions: ["UserMode", "SubagentMode"],
  runModeSettings: {
    promptCooldownSeconds: 20,
    safetyBlockingEnabled: true,
    normalizeCodeToText: true,
    keepUserHistory: false,
    historyLogFile: "data/requestHistory.jsonl"
  },
  SubagentMode: {
    plannerPath: "agent-run-subagent",
    lowCostModel: "gpt-4.1-mini",
    enableSearchVerifier: true,
    searchSource: "duckduckgo-html"
  },
  UserMode: {
    plannerPath: "runtime-user",
    lowCostModel: "gpt-5-mini",
    enableSearchVerifier: true,
    searchSource: "duckduckgo-html"
  }
};

function deepMerge(base, override) {
  const merged = { ...base };

  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof merged[key] === "object") {
      merged[key] = deepMerge(merged[key], value);
      continue;
    }
    merged[key] = value;
  }

  return merged;
}

export function loadRuntimeConfig() {
  if (!existsSync(rootConfigPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(rootConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function resolveActiveModeConfig(config) {
  const modeOptions = Array.isArray(config.modeOptions) && config.modeOptions.length
    ? config.modeOptions
    : DEFAULT_CONFIG.modeOptions;

  const requestedMode = String(config.mode || "UserMode");
  const mode = modeOptions.includes(requestedMode) ? requestedMode : "UserMode";
  const modeConfig = mode === "SubagentMode" ? config.SubagentMode : config.UserMode;

  return {
    mode,
    modeOptions,
    modeConfig: deepMerge(DEFAULT_CONFIG.SubagentMode, modeConfig || {})
  };
}

export function getRuntimeConfigPath() {
  return rootConfigPath;
}
