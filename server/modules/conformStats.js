import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../../data");
const statsFile = path.join(dataDir, "conformStats.json");

const INITIAL_STATE = {
  updatedAt: null,
  totalRequests: 0,
  totalPipelineRunFailures: 0,
  totalForcedThirdRunAcceptances: 0,
  averagePipelineRunFailuresPerRequest: 0,
  recentRequests: []
};

function ensureDataPath() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function toAverage(totalFailures, totalRequests) {
  if (!totalRequests) {
    return 0;
  }
  return Number((totalFailures / totalRequests).toFixed(4));
}

export function createConformStatsStore() {
  let state = { ...INITIAL_STATE };

  const save = () => {
    state.updatedAt = new Date().toISOString();
    writeFileSync(statsFile, JSON.stringify(state, null, 2), "utf-8");
  };

  return {
    async load() {
      ensureDataPath();

      if (!existsSync(statsFile)) {
        save();
        return;
      }

      const raw = readFileSync(statsFile, "utf-8");

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

    recordRequest({ pipelineRunFailures = 0, forcedThirdRunAcceptance = false, pipelineRunsUsed = 1 }) {
      const failures = Number.isFinite(Number(pipelineRunFailures)) ? Math.max(0, Number(pipelineRunFailures)) : 0;
      const runsUsed = Number.isFinite(Number(pipelineRunsUsed)) ? Math.max(1, Number(pipelineRunsUsed)) : 1;

      state.totalRequests += 1;
      state.totalPipelineRunFailures += failures;
      if (forcedThirdRunAcceptance) {
        state.totalForcedThirdRunAcceptances += 1;
      }
      state.averagePipelineRunFailuresPerRequest = toAverage(
        state.totalPipelineRunFailures,
        state.totalRequests
      );

      state.recentRequests.unshift({
        timestamp: new Date().toISOString(),
        pipelineRunFailures: failures,
        pipelineRunsUsed: runsUsed,
        forcedThirdRunAcceptance: Boolean(forcedThirdRunAcceptance)
      });
      state.recentRequests = state.recentRequests.slice(0, 500);

      save();

      return {
        totalRequests: state.totalRequests,
        totalPipelineRunFailures: state.totalPipelineRunFailures,
        averagePipelineRunFailuresPerRequest: state.averagePipelineRunFailuresPerRequest,
        totalForcedThirdRunAcceptances: state.totalForcedThirdRunAcceptances
      };
    },

    summary() {
      return {
        updatedAt: state.updatedAt,
        totalRequests: state.totalRequests,
        totalPipelineRunFailures: state.totalPipelineRunFailures,
        averagePipelineRunFailuresPerRequest: state.averagePipelineRunFailuresPerRequest,
        totalForcedThirdRunAcceptances: state.totalForcedThirdRunAcceptances,
        recentRequests: state.recentRequests.slice(0, 120)
      };
    }
  };
}
