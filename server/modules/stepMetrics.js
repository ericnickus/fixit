import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../../data");
const metricsFile = path.join(dataDir, "stepMetrics.json");

const INITIAL_STATE = {
  updatedAt: null,
  stepAggregates: {},
  recentEvents: []
};

function ensureDataPath() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function computeViability(done, failed) {
  // Laplace smoothing keeps early stats from oscillating wildly.
  return Number(((done + 1) / (done + failed + 2)).toFixed(4));
}

function percent(value) {
  return Number((value * 100).toFixed(1));
}

export function createStepMetricsStore() {
  let state = { ...INITIAL_STATE };

  const save = () => {
    state.updatedAt = new Date().toISOString();
    writeFileSync(metricsFile, JSON.stringify(state, null, 2), "utf-8");
  };

  return {
    async load() {
      ensureDataPath();

      if (!existsSync(metricsFile)) {
        save();
        return;
      }

      const raw = readFileSync(metricsFile, "utf-8");

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

    record(event) {
      const issueKey = slugify(event.issueFingerprint || "unknown_issue");
      const stepKey = slugify(`${event.stepId}_${event.stepTitle}`);
      const aggregateKey = `${issueKey}::${stepKey}`;

      if (!state.stepAggregates[aggregateKey]) {
        state.stepAggregates[aggregateKey] = {
          issueFingerprint: issueKey,
          stepId: event.stepId,
          stepTitle: event.stepTitle,
          done: 0,
          failed: 0,
          total: 0,
          viabilityScore: 0.5
        };
      }

      const aggregate = state.stepAggregates[aggregateKey];
      aggregate.total += 1;

      if (event.outcome === "done") {
        aggregate.done += 1;
      }

      if (event.outcome === "failed") {
        aggregate.failed += 1;
      }

      aggregate.viabilityScore = computeViability(aggregate.done, aggregate.failed);

      state.recentEvents.unshift({
        ...event,
        aggregateKey
      });
      state.recentEvents = state.recentEvents.slice(0, 1000);

      save();

      return {
        aggregateKey,
        viabilityScore: aggregate.viabilityScore,
        userScore: percent(aggregate.viabilityScore),
        done: aggregate.done,
        failed: aggregate.failed,
        total: aggregate.total
      };
    },

    getScoresForPlan(issueFingerprint, steps) {
      const issueKey = slugify(issueFingerprint || "unknown_issue");

      return steps.map((step) => {
        const stepKey = slugify(`${step.id}_${step.title}`);
        const aggregateKey = `${issueKey}::${stepKey}`;
        const aggregate = state.stepAggregates[aggregateKey];

        if (!aggregate) {
          return {
            stepId: step.id,
            userScore: 50,
            done: 0,
            failed: 0,
            total: 0
          };
        }

        return {
          stepId: step.id,
          userScore: percent(aggregate.viabilityScore),
          done: aggregate.done,
          failed: aggregate.failed,
          total: aggregate.total
        };
      });
    },

    summary() {
      const aggregates = Object.values(state.stepAggregates);
      const toughestSteps = [...aggregates]
        .sort((a, b) => a.viabilityScore - b.viabilityScore)
        .slice(0, 15);

      const strongestSteps = [...aggregates]
        .sort((a, b) => b.viabilityScore - a.viabilityScore)
        .slice(0, 15);

      return {
        updatedAt: state.updatedAt,
        totalTrackedSteps: aggregates.length,
        recentEvents: state.recentEvents.slice(0, 120),
        toughestSteps,
        strongestSteps
      };
    }
  };
}
