import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../../data");
const memoryFile = path.join(dataDir, "agentMemory.json");

const INITIAL_STATE = {
  updatedAt: null,
  issueCounts: {},
  toolHintCounts: {}
};

function ensureDataPath() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function normalizeTip(tip) {
  return String(tip || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function createSelfMemoryStore() {
  let state = { ...INITIAL_STATE };

  const save = () => {
    state.updatedAt = new Date().toISOString();
    writeFileSync(memoryFile, JSON.stringify(state, null, 2), "utf-8");
  };

  return {
    async load() {
      ensureDataPath();

      if (!existsSync(memoryFile)) {
        save();
        return;
      }

      const raw = readFileSync(memoryFile, "utf-8");

      try {
        const parsed = JSON.parse(raw);
        state = {
          ...INITIAL_STATE,
          ...parsed
        };
      } catch {
        state = { ...INITIAL_STATE };
        save();
      }
    },

    rememberIssue(issueFingerprint) {
      const key = String(issueFingerprint || "unknown").trim().toLowerCase();
      if (!key) {
        return;
      }

      state.issueCounts[key] = (state.issueCounts[key] || 0) + 1;
      save();
    },

    absorbPlan(plan) {
      const tips = Array.isArray(plan.toolSuggestions) ? plan.toolSuggestions : [];

      for (const tip of tips) {
        const cleaned = normalizeTip(tip);
        if (!cleaned) {
          continue;
        }
        state.toolHintCounts[cleaned] = (state.toolHintCounts[cleaned] || 0) + 1;
      }

      save();
    },

    getTopToolHints(limit = 8) {
      return Object.entries(state.toolHintCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([hint]) => hint);
    }
  };
}
