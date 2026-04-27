import { useMemo, useState } from "react";

const INITIAL_INTAKE = {
  repairGoal: "",
  deviceType: "",
  brand: "",
  model: "",
  ageYears: "",
  symptom: "",
  exactWhen: "",
  soundSmell: "",
  errorCodes: "",
  attemptedFixes: "",
  availableTools: "",
  confidenceLevel: "Beginner",
  safetyConcerns: "",
  locationSetup: "",
  budgetBand: "",
  urgency: "Normal",
  constraints: ""
};

function buildIssueFingerprint(intake) {
  return [
    intake.deviceType,
    intake.brand,
    intake.model,
    intake.symptom,
    intake.errorCodes
  ]
    .map((item) => (item || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function App() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [intake, setIntake] = useState(INITIAL_INTAKE);
  const [plan, setPlan] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [eventLog, setEventLog] = useState([]);
  const [failedClicksByStep, setFailedClicksByStep] = useState({});
  const [photoHintByStep, setPhotoHintByStep] = useState({});
  const [completedFlow, setCompletedFlow] = useState(false);

  const steps = plan?.steps || [];
  const currentStep = steps[currentStepIndex] || null;

  const completionPercent = useMemo(() => {
    if (!steps.length) {
      return 0;
    }

    return Math.round(((currentStepIndex + 1) / steps.length) * 100);
  }, [currentStepIndex, steps.length]);

  const doneCount = eventLog.filter((entry) => entry.outcome === "done").length;
  const failedCount = eventLog.filter((entry) => entry.outcome === "failed").length;

  const updateField = (fieldName) => (event) => {
    setIntake((current) => ({ ...current, [fieldName]: event.target.value }));
  };

  const resetPlan = () => {
    setPlan(null);
    setCurrentStepIndex(0);
    setShowAllSteps(false);
    setEventLog([]);
    setFailedClicksByStep({});
    setPhotoHintByStep({});
    setCompletedFlow(false);
    setError("");
  };

  const requestPlan = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/repair-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...intake,
          sessionId,
          issueFingerprint: buildIssueFingerprint(intake)
        })
      });

      if (!response.ok) {
        throw new Error("Unable to generate a repair plan right now.");
      }

      const payload = await response.json();

      if (!payload.steps || payload.steps.length === 0) {
        throw new Error("The response had no actionable steps.");
      }

      setPlan(payload);
      setCurrentStepIndex(0);
      setCompletedFlow(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      setError(requestError.message || "Something went wrong while creating your plan.");
    } finally {
      setSubmitting(false);
    }
  };

  const postStepEvent = async (step, outcome, index) => {
    const entry = {
      stepId: step.id,
      stepTitle: step.title,
      outcome,
      stepIndex: index,
      timestamp: new Date().toISOString()
    };

    setEventLog((current) => [entry, ...current].slice(0, 120));

    try {
      await fetch("/api/step-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...entry,
          sessionId,
          issueFingerprint: buildIssueFingerprint(intake)
        })
      });
    } catch {
      // Local state still captures outcomes if telemetry transport is unavailable.
    }
  };

  const goToIndex = (index) => {
    setCurrentStepIndex(index);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`step-${index}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  };

  const onStepOutcome = async (step, outcome, index) => {
    await postStepEvent(step, outcome, index);

    if (outcome === "failed") {
      setFailedClicksByStep((current) => ({
        ...current,
        [step.id]: (current[step.id] || 0) + 1
      }));

      if (step.failedNextId) {
        const failedTargetIndex = steps.findIndex((item) => item.id === step.failedNextId);
        if (failedTargetIndex >= 0) {
          goToIndex(failedTargetIndex);
        }
      }
      return;
    }

    if (index >= steps.length - 1) {
      setCompletedFlow(true);
      return;
    }

    const nextIndex = index + 1;
    goToIndex(nextIndex);
  };

  const renderStepCard = (step, index, options = { interactive: false, preview: false }) => {
    const { interactive, preview } = options;
    const failedClicks = failedClicksByStep[step.id] || 0;

    return (
      <article
        id={`step-${index}`}
        key={step.id}
        className={`step-card ${interactive ? "interactive" : ""} ${preview ? "preview-card" : ""}`}
      >
        <p className="step-count">
          Step {index + 1} of {steps.length}
        </p>
        <h3>{step.title}</h3>
        <p className="action-line">{step.action}</p>
        <ul className="detail-list">
          <li>
            <span>Why this matters:</span> {step.whyImportant}
          </li>
          <li>
            <span>Safety check:</span> {step.caution}
          </li>
          <li>
            <span>Done when:</span> {step.doneCheck}
          </li>
          <li>
            <span>If it fails:</span> {step.fallbackAction}
          </li>
        </ul>

        <div className="score-row">
          <p>
            User score: <strong>{typeof step.userScore === "number" ? `${step.userScore}%` : "50%"}</strong>
          </p>
          <p>
            Result score: <strong>{typeof step.resultScore === "number" ? `${step.resultScore}%` : "50%"}</strong>
          </p>
          <p>
            Combined: <strong>{typeof step.combinedScore === "number" ? `${step.combinedScore}%` : "50%"}</strong>
          </p>
          <p>
            Band: <strong>{step.scoreBand || "medium"}</strong>
          </p>
        </div>

        {Array.isArray(step.resultEvidence) && step.resultEvidence.length > 0 ? (
          <p className="result-evidence">Parity check: {step.resultEvidence[0]}</p>
        ) : null}

        {step.tools && step.tools.length > 0 ? (
          <p className="tool-row">
            Tools: {step.tools.join(", ")}
          </p>
        ) : null}

        {interactive ? (
          <div className="step-actions">
            <button type="button" className="btn btn-done" onClick={() => onStepOutcome(step, "done", index)}>
              Done
            </button>
            <button type="button" className="btn btn-failed" onClick={() => onStepOutcome(step, "failed", index)}>
              Did Not Work
            </button>
          </div>
        ) : null}

        {interactive && failedClicks >= 2 ? (
          <div className="photo-module">
            <h4>Advanced Assist Module</h4>
            <p>
              This step failed multiple times. Add a short visual note so a follow-up AI pass can prioritize what
              to inspect next.
            </p>
            <label>
              Photo note
              <textarea
                value={photoHintByStep[step.id] || ""}
                onChange={(event) =>
                  setPhotoHintByStep((current) => ({
                    ...current,
                    [step.id]: event.target.value
                  }))
                }
                placeholder="Example: There is rust around the valve and a burnt smell near the connector."
              />
            </label>
          </div>
        ) : null}
      </article>
    );
  };

  return (
    <div className="app-shell">
      <div className="texture-orb texture-orb-left" />
      <div className="texture-orb texture-orb-right" />

      <header className="hero">
        <p className="badge">FIXITYERSELF.com</p>
        <h1>Fix What Broke. Keep the Signal High.</h1>
        <p>
          Structured repair intake, AI step generation, low-noise cleanup, and button-level analytics that improve
          future versions.
        </p>
      </header>

      {!plan ? (
        <section className="intake-wrap">
          <h2>Tell us exactly what is broken</h2>
          <p>
            This form is designed to preserve every important detail while removing low-signal chatter before sending
            data to the AI agent.
          </p>

          <form className="intake-grid" onSubmit={requestPlan}>
            <label>
              Repair goal
              <input
                value={intake.repairGoal}
                onChange={updateField("repairGoal")}
                placeholder="Example: Stop washer leak and run one full cycle"
                required
              />
            </label>

            <label>
              Device type
              <input value={intake.deviceType} onChange={updateField("deviceType")} placeholder="Dryer" required />
            </label>

            <label>
              Brand
              <input value={intake.brand} onChange={updateField("brand")} placeholder="Whirlpool" />
            </label>

            <label>
              Model
              <input value={intake.model} onChange={updateField("model")} placeholder="WED5600XW0" />
            </label>

            <label>
              Approximate age (years)
              <input value={intake.ageYears} onChange={updateField("ageYears")} placeholder="8" />
            </label>

            <label>
              Confidence level
              <select value={intake.confidenceLevel} onChange={updateField("confidenceLevel")}>
                <option>Beginner</option>
                <option>Intermediate</option>
                <option>Advanced</option>
              </select>
            </label>

            <label className="full-width">
              Main symptom
              <textarea
                value={intake.symptom}
                onChange={updateField("symptom")}
                placeholder="Clothes are still wet after full dry cycle."
                required
              />
            </label>

            <label className="full-width">
              Exactly when it fails
              <textarea
                value={intake.exactWhen}
                onChange={updateField("exactWhen")}
                placeholder="Heats for 5 minutes, then cold air for the rest of the cycle."
              />
            </label>

            <label>
              Sound or smell clues
              <input value={intake.soundSmell} onChange={updateField("soundSmell")} placeholder="Burnt dust smell" />
            </label>

            <label>
              Error codes
              <input value={intake.errorCodes} onChange={updateField("errorCodes")} placeholder="F31" />
            </label>

            <label className="full-width">
              What you already tried
              <textarea
                value={intake.attemptedFixes}
                onChange={updateField("attemptedFixes")}
                placeholder="Cleaned lint filter and vent hose."
              />
            </label>

            <label className="full-width">
              Tools available
              <textarea
                value={intake.availableTools}
                onChange={updateField("availableTools")}
                placeholder="Flathead screwdriver, socket set, needle nose pliers"
              />
            </label>

            <label className="full-width">
              Safety concerns and limits
              <textarea
                value={intake.safetyConcerns}
                onChange={updateField("safetyConcerns")}
                placeholder="Cannot lift appliance alone. No gas tools."
              />
            </label>

            <label>
              Budget band
              <input value={intake.budgetBand} onChange={updateField("budgetBand")} placeholder="$0-$100" />
            </label>

            <label>
              Urgency
              <select value={intake.urgency} onChange={updateField("urgency")}>
                <option>Low</option>
                <option>Normal</option>
                <option>High</option>
                <option>Emergency</option>
              </select>
            </label>

            <label className="full-width">
              Location and setup details
              <textarea
                value={intake.locationSetup}
                onChange={updateField("locationSetup")}
                placeholder="Stacked laundry closet, low ceiling, rear panel hard to access"
              />
            </label>

            <label className="full-width">
              Hard constraints
              <textarea
                value={intake.constraints}
                onChange={updateField("constraints")}
                placeholder="Need this working tonight, no part orders until tomorrow"
              />
            </label>

            <button className="btn btn-submit" disabled={submitting} type="submit">
              {submitting ? "Building high-signal plan..." : "Generate Repair Plan"}
            </button>
          </form>

          {error ? <p className="error-text">{error}</p> : null}
        </section>
      ) : (
        <section className="plan-wrap">
          <div className="plan-topbar">
            <div>
              <h2>{plan.title}</h2>
              <p className="plan-summary">{plan.simpleSummary}</p>
            </div>

            <div className="plan-controls">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={showAllSteps}
                  onChange={(event) => setShowAllSteps(event.target.checked)}
                />
                Show all step windows on one scrolling page
              </label>
              <button type="button" className="btn btn-reset" onClick={resetPlan}>
                Start Over
              </button>
            </div>
          </div>

          <div className="progress-track" aria-label="Repair step progress">
            <span style={{ width: `${completionPercent}%` }} />
          </div>

          <div className="layout-grid">
            <div>
              {showAllSteps ? (
                <div className="step-list-view">{steps.map((step, index) => renderStepCard(step, index, { interactive: true }))}</div>
              ) : (
                <div className="single-view">
                  {currentStepIndex > 0 ? renderStepCard(steps[currentStepIndex - 1], currentStepIndex - 1, { preview: true }) : null}
                  {currentStep ? renderStepCard(currentStep, currentStepIndex, { interactive: true }) : null}
                  {currentStepIndex < steps.length - 1
                    ? renderStepCard(steps[currentStepIndex + 1], currentStepIndex + 1, { preview: true })
                    : null}
                </div>
              )}

              {completedFlow ? (
                <div className="completion-panel">
                  <h3>Repair flow complete</h3>
                  <p>
                    Great work. Use the review button to scroll back through each step and verify final checks.
                  </p>
                  <button
                    type="button"
                    className="btn btn-review"
                    onClick={() => {
                      setShowAllSteps(true);
                      goToIndex(0);
                    }}
                  >
                    Review All Steps From Top
                  </button>
                </div>
              ) : null}
            </div>

            <aside className="insights-panel">
              <h3>Tool Use Suggestions</h3>
              <ul>
                {(plan.toolSuggestions || []).map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>

              <h3>Likely Parts</h3>
              <ul>
                {(plan.partsNeeded || []).map((part) => (
                  <li key={part}>{part}</li>
                ))}
              </ul>

              <h3>Session Analytics</h3>
              <p>Done taps: {doneCount}</p>
              <p>Did Not Work taps: {failedCount}</p>
              <p>User score = internal success parity from button outcomes.</p>
              <p>Result score = internet parity with similar successful fixes.</p>

              <h3>Recent Button Log</h3>
              <ul className="log-list">
                {eventLog.slice(0, 8).map((item) => (
                  <li key={`${item.timestamp}-${item.stepId}`}>
                    <strong>{item.outcome.toUpperCase()}</strong> Step {item.stepIndex + 1}: {item.stepTitle}
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>
      )}
    </div>
  );
}

export default App;
