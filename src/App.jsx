import { useEffect, useMemo, useRef, useState } from "react";
const SPONSORED_SLOT_COUNT = 4;
const PRESET_STORAGE_KEY = "fixityerself-intake-presets-v1";
const PLAN_REQUEST_TIMEOUT_MS = 35000;
const MAX_TRY_SOMETHING_ELSE_PER_STEP = 3;

function pickOneOrTwoSentences(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  const matches = text.match(/[^.!?]+[.!?]?/g) || [text];
  const trimmed = matches.map((item) => item.trim()).filter(Boolean);
  return trimmed.slice(0, 2).join(" ").trim();
}

function normalizeSafetySentence(value) {
  const base = pickOneOrTwoSentences(value) || "Disconnect power before touching internal parts.";
  const sentence = /[.!?]$/.test(base) ? base : `${base}.`;
  const compacted = sentence.replace(/\s+/g, " ").trim();
  return `*${compacted}`;
}

function buildStepVariants(step) {
  const isDummyPilotStep = String(step?.title || "").trim().toLowerCase() === "things to check first";

  const normalizeVariant = (value) => {
    if (!isDummyPilotStep) {
      return pickOneOrTwoSentences(value);
    }

    const lines = String(value || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 4);

    if (lines.length > 0) {
      return lines.join("\n");
    }

    return pickOneOrTwoSentences(value);
  };

  const variants = [step?.action, step?.alternateAction, step?.fallbackAction]
    .map((item) => normalizeVariant(item))
    .filter(Boolean);

  const unique = [...new Set(variants)];
  if (unique.length >= 2) {
    return unique;
  }

  const base = unique[0] || "Inspect this component and verify expected behavior.";
  return [
    base,
    `Try a different approach: ${base}`
  ];
}

const INITIAL_INTAKE = {
  repairGoal: "",
  deviceType: "",
  brand: "",
  model: "",
  ageYears: "",
  exactWhen: "",
  soundSmell: "",
  errorCodes: "",
  attemptedFixes: "",
  confidenceLevel: "Beginner"
};

const MANUAL_PRESET_1 = {
  repairGoal: "speaker crackling and distorted",
  deviceType: "speaker",
  brand: "dynaudio",
  model: "BM not sure",
  ageYears: "",
  exactWhen: "always makes this noise",
  soundSmell: "",
  errorCodes: "",
  attemptedFixes: "jiggled cable around and that didn't work",
  confidenceLevel: "Intermediate"
};

function sanitizePresetCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const next = { ...INITIAL_INTAKE };
  let hasValue = false;

  for (const key of Object.keys(INITIAL_INTAKE)) {
    if (typeof candidate[key] === "string") {
      next[key] = candidate[key];
      if (candidate[key].trim()) {
        hasValue = true;
      }
    }
  }

  return hasValue ? next : null;
}

function loadPresetState() {
  const defaults = [
    { ...MANUAL_PRESET_1 },
    null,
    null,
    null
  ];

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return defaults;
    }

    const restored = defaults.map((preset, index) => {
      if (index === 0) {
        return { ...MANUAL_PRESET_1 };
      }
      return sanitizePresetCandidate(parsed[index]) || preset;
    });

    return restored;
  } catch {
    return defaults;
  }
}

function estimateBudgetRange(partsCount) {
  const min = Math.max(35, partsCount * 30);
  const max = Math.max(90, partsCount * 75);
  const hackMax = Math.max(20, partsCount * 20);

  return {
    best: `$${min}-$${max}`,
    hack: `$0-$${hackMax}`
  };
}

function buildIssueFingerprint(intake) {
  return [
    intake.deviceType,
    intake.brand,
    intake.model,
    intake.repairGoal,
    intake.errorCodes
  ]
    .map((item) => (item || "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function App() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [intake, setIntake] = useState(INITIAL_INTAKE);
  const photoFileInputRef = useRef(null);
  const attemptedFixesInputRef = useRef(null);
  const photoAnalyzeTimerRef = useRef(null);
  const [plan, setPlan] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [schemaErrors, setSchemaErrors] = useState([]);
  const [eventLog, setEventLog] = useState([]);
  const [variationIndexByStep, setVariationIndexByStep] = useState({});
  const [completedFlow, setCompletedFlow] = useState(false);
  const [submitStartedAt, setSubmitStartedAt] = useState(0);
  const [submitElapsedSeconds, setSubmitElapsedSeconds] = useState(0);
  const [presets, setPresets] = useState(loadPresetState);
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [photoAnalyzing, setPhotoAnalyzing] = useState(false);
  const [photoAnalysisComplete, setPhotoAnalysisComplete] = useState(false);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [photoStatusError, setPhotoStatusError] = useState("");

  const baseSteps = plan?.steps || [];
  const steps = useMemo(() => {
    if (!plan || baseSteps.length === 0) {
      return [];
    }

    return baseSteps;
  }, [plan, baseSteps]);
  const currentStep = steps[currentStepIndex] || null;

  useEffect(() => {
    if (!submitting) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setSubmitElapsedSeconds(Math.max(0, Math.round((Date.now() - submitStartedAt) / 1000)));
    }, 250);

    return () => window.clearInterval(timer);
  }, [submitting, submitStartedAt]);

  useEffect(() => {
    return () => {
      if (photoAnalyzeTimerRef.current) {
        window.clearTimeout(photoAnalyzeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
    } catch {
      // Ignore persistence errors in restricted environments.
    }
  }, [presets]);

  const completionPercent = useMemo(() => {
    if (!steps.length) {
      return 0;
    }

    return Math.round(((currentStepIndex + 1) / steps.length) * 100);
  }, [currentStepIndex, steps.length]);

  const updateField = (fieldName) => (event) => {
    setIntake((current) => ({ ...current, [fieldName]: event.target.value }));
    setFormErrors((current) => {
      if (!current[fieldName]) {
        return current;
      }
      const next = { ...current };
      delete next[fieldName];
      return next;
    });
  };

  const resetPlan = ({ clearIntake = false } = {}) => {
    setPlan(null);
    setCurrentStepIndex(0);
    setShowAllSteps(false);
    setEventLog([]);
    setVariationIndexByStep({});
    setCompletedFlow(false);
    setFormErrors({});
    setSchemaErrors([]);
    setError("");

    if (clearIntake) {
      setIntake({ ...INITIAL_INTAKE });
      setPhotoDataUrl("");
      setPhotoAnalyzing(false);
      setPhotoAnalysisComplete(false);
      setPhotoDragOver(false);
      setPhotoStatusError("");
      if (photoFileInputRef.current) {
        photoFileInputRef.current.value = "";
      }
    }
  };

  const loadPhotoFile = (file) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      setPhotoStatusError("Please choose an image file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPhotoDataUrl(String(reader.result || ""));
      setPhotoAnalysisComplete(false);
      setPhotoStatusError("");
    };
    reader.onerror = () => {
      setPhotoStatusError("Photo could not be loaded.");
    };
    reader.readAsDataURL(file);
  };

  const onPhotoPickerChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    loadPhotoFile(file);
  };

  const onPhotoDrop = (event) => {
    event.preventDefault();
    setPhotoDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    loadPhotoFile(file);
  };

  const onPhotoAnalyzeSubmit = () => {
    if (!photoDataUrl) {
      setPhotoStatusError("Add a photo first.");
      return;
    }

    if (photoAnalyzeTimerRef.current) {
      window.clearTimeout(photoAnalyzeTimerRef.current);
    }

    setPhotoStatusError("");
    setPhotoAnalysisComplete(false);
    setPhotoAnalyzing(true);

    photoAnalyzeTimerRef.current = window.setTimeout(() => {
      setPhotoAnalyzing(false);
      setPhotoAnalysisComplete(true);
      photoAnalyzeTimerRef.current = null;
    }, 4000);
  };

  const clearAllInput = () => {
    if (photoAnalyzeTimerRef.current) {
      window.clearTimeout(photoAnalyzeTimerRef.current);
      photoAnalyzeTimerRef.current = null;
    }

    setIntake({ ...INITIAL_INTAKE });
    setFormErrors({});
    setSchemaErrors([]);
    setError("");
    setPhotoDataUrl("");
    setPhotoAnalyzing(false);
    setPhotoAnalysisComplete(false);
    setPhotoDragOver(false);
    setPhotoStatusError("");

    if (photoFileInputRef.current) {
      photoFileInputRef.current.value = "";
    }
  };

  const requestPlan = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitStartedAt(Date.now());
    setSubmitElapsedSeconds(0);
    setError("");
    setFormErrors({});
    setSchemaErrors([]);

    const requiredFields = ["repairGoal", "deviceType"];
    const nextFormErrors = {};
    for (const fieldName of requiredFields) {
      if (!String(intake[fieldName] || "").trim()) {
        nextFormErrors[fieldName] = "Required";
      }
    }

    if (Object.keys(nextFormErrors).length > 0) {
      setFormErrors(nextFormErrors);
      setError("Please fill all required fields marked with *.");
      setSubmitting(false);
      return;
    }

    const requestBody = {
      ...intake,
      symptom: intake.repairGoal,
      sessionId,
      issueFingerprint: buildIssueFingerprint(intake)
    };

    resetPlan();

    let timeoutHandle = null;
    try {
      const controller = new AbortController();
      timeoutHandle = window.setTimeout(() => controller.abort(), PLAN_REQUEST_TIMEOUT_MS);

      const response = await fetch("/api/repair-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        let details = null;
        try {
          details = await response.json();
        } catch {
          details = null;
        }

        if (details?.details?.fieldErrors) {
          setFormErrors(details.details.fieldErrors);
        }
        if (Array.isArray(details?.details?.formErrors) && details.details.formErrors.length > 0) {
          setSchemaErrors(details.details.formErrors);
        }

        const backendError = typeof details?.error === "string" ? details.error.trim() : "";
        const backendWarning = typeof details?.warning === "string" ? details.warning.trim() : "";
        const mergedMessage = [backendError, backendWarning].filter(Boolean).join(" ");
        const warningLower = backendWarning.toLowerCase();

        if (response.status === 429 || warningLower.includes("quota") || warningLower.includes("rate limit")) {
          throw new Error(
            "OpenAI quota/rate limit reached for the active model. Check billing/limits for this API key or switch run mode/model."
          );
        }

        throw new Error(mergedMessage || "Unable to generate a repair plan right now.");
      }

      const payload = await response.json();

      if (!payload.steps || payload.steps.length === 0) {
        throw new Error("The response had no actionable steps.");
      }

      setPlan(payload);
      setCurrentStepIndex(0);
      setCompletedFlow(false);
      setVariationIndexByStep({});
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      if (requestError?.name === "AbortError") {
        setError(
          `Planner request timed out after ${Math.round(PLAN_REQUEST_TIMEOUT_MS / 1000)}s. Please retry with a shorter symptom summary or try again in a moment.`
        );
        return;
      }
      setError(requestError.message || "Something went wrong while creating your plan.");
    } finally {
      if (timeoutHandle) {
        window.clearTimeout(timeoutHandle);
      }
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
      const nextFailureCount = (variationIndexByStep[step.id] || 0) + 1;
      if (nextFailureCount >= MAX_TRY_SOMETHING_ELSE_PER_STEP) {
        resetPlan();
        setError("Start over and add the step you could not accomplish to the list of what you have already tried.");
        window.requestAnimationFrame(() => {
          attemptedFixesInputRef.current?.focus();
          attemptedFixesInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }

      setVariationIndexByStep((current) => ({
        ...current,
        [step.id]: nextFailureCount
      }));
      return;
    }

    if (index >= steps.length - 1) {
      setCompletedFlow(true);
      return;
    }

    const nextIndex = index + 1;
    goToIndex(nextIndex);
  };

  const onPresetClick = (index) => {
    const selectedPreset = presets[index];

    if (selectedPreset) {
      setIntake({ ...INITIAL_INTAKE, ...selectedPreset });
      setPlan(null);
      setCurrentStepIndex(0);
      setShowAllSteps(false);
      setEventLog([]);
      setVariationIndexByStep({});
      setCompletedFlow(false);
      setFormErrors({});
      setSchemaErrors([]);
      setError("");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const snapshot = { ...INITIAL_INTAKE, ...intake };
    setPresets((current) => {
      // Presets are write-once: once a slot is set, it can only be recalled.
      if (current[index]) {
        return current;
      }
      const next = [...current];
      next[index] = snapshot;
      return next;
    });
  };

  const renderStepCard = (step, index, options = { interactive: false }) => {
    const { interactive } = options;
    const variations = buildStepVariants(step);
    const variationIndex = variationIndexByStep[step.id] || 0;
    const actionText = variations[variationIndex % variations.length] || "No action available.";
    const safetyText = normalizeSafetySentence(step.caution);

    return (
      <article
        id={`step-${index}`}
        key={step.id}
        className={`step-card ${interactive ? "interactive" : ""}`}
      >
        <p className="action-line">{actionText}</p>
        <p className="step-safety-line">{safetyText}</p>

        {interactive ? (
          <div className="step-actions">
            <button
              type="button"
              className="btn btn-back"
              onClick={() => goToIndex(Math.max(0, index - 1))}
              disabled={index === 0}
            >
              Go Back
            </button>
            <button type="button" className="btn btn-done" onClick={() => onStepOutcome(step, "done", index)}>
              OK
            </button>
            <button type="button" className="btn btn-failed" onClick={() => onStepOutcome(step, "failed", index)}>
              Try Something Else
            </button>
          </div>
        ) : null}
      </article>
    );
  };

  const renderPreviewTitleCard = (step, key, label, toneClass = "") => (
    <article
      key={key}
      className={`preview-title-card ${toneClass} ${step ? "" : "preview-title-empty"}`.trim()}
      aria-label={label}
    >
      <p className="preview-title-label">{label}</p>
      <p className="preview-title-text">{step?.title || "No step"}</p>
    </article>
  );

  const renderPreviewSpacer = (key, toneClass = "") => (
    <div
      key={key}
      className={`preview-title-card preview-slot-spacer ${toneClass}`.trim()}
      aria-hidden="true"
    />
  );

  return (
    <div className="app-shell">
      <div className="texture-orb texture-orb-left" />
      <div className="texture-orb texture-orb-right" />

      <header className="hero">
        <p className="badge">FIXITYERSELF.com</p>
        <h1>Fix What Broke. Skip the Confusion.</h1>
      </header>

      <div className="main-panels">
        <div className="display-column">
        {!plan ? (
          <section className="intake-wrap">
            <h2>Tell us exactly what needs to be fixed</h2>

            <form className="intake-grid" onSubmit={requestPlan}>
            <label className="full-width">
              Repair goal (main symptoms) <span className="required-marker">*</span>
              <textarea
                className="two-line-textarea"
                value={intake.repairGoal}
                onChange={updateField("repairGoal")}
                placeholder="Example: Dryer runs but clothes stay wet"
                rows={2}
                required
              />
              {formErrors.repairGoal ? <small className="field-error">Required field.</small> : null}
            </label>

            <label>
              Device type <span className="required-marker">*</span>
              <input value={intake.deviceType} onChange={updateField("deviceType")} placeholder="Dryer" required />
              {formErrors.deviceType ? <small className="field-error">Required field.</small> : null}
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
              Exactly when it fails
              <textarea
                className="two-line-textarea"
                value={intake.exactWhen}
                onChange={updateField("exactWhen")}
                placeholder="Heats for 5 minutes, then cold air for the rest of the cycle."
                rows={2}
              />
            </label>

            <div className="photo-error-row full-width">
              <label className="sound-smell-field">
                Sound or smell clues
                <input value={intake.soundSmell} onChange={updateField("soundSmell")} placeholder="Burnt dust smell" />
              </label>

              <label className="error-codes-field">
                Error codes
                <input value={intake.errorCodes} onChange={updateField("errorCodes")} placeholder="F31" />
              </label>

              <div className="photo-upload-field">
                <p className={`photo-upload-title ${photoAnalysisComplete ? "complete" : ""}`}>
                  {photoAnalysisComplete ? "photo analysis complete" : "Submit photo"}
                </p>
                <input
                  ref={photoFileInputRef}
                  type="file"
                  accept="image/*"
                  className="photo-input-hidden"
                  onChange={onPhotoPickerChange}
                />
                <div
                  className={`photo-dropzone ${photoDragOver ? "drag-over" : ""}`}
                  onClick={() => photoFileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setPhotoDragOver(true);
                  }}
                  onDragLeave={() => setPhotoDragOver(false)}
                  onDrop={onPhotoDrop}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      photoFileInputRef.current?.click();
                    }
                  }}
                >
                  {photoDataUrl ? <img src={photoDataUrl} alt="Submitted issue" /> : <p>Drag/drop or click to pick</p>}
                  {photoAnalyzing ? (
                    <div className="photo-analysis-overlay">
                      <span className="spinner-wheel photo-spinner" aria-hidden="true" />
                      <span>analyzing your photo</span>
                    </div>
                  ) : null}
                </div>
                <button type="button" className="btn btn-photo-submit" onClick={onPhotoAnalyzeSubmit}>
                  Submit Photo
                </button>
                {photoStatusError ? <p className="photo-analysis-error">{photoStatusError}</p> : null}
              </div>
            </div>

            <label className="full-width tried-field">
              What you already tried
              <input
                ref={attemptedFixesInputRef}
                value={intake.attemptedFixes}
                onChange={updateField("attemptedFixes")}
                placeholder="Cleaned lint filter and vent hose."
              />
            </label>

              <button className="btn btn-submit" disabled={submitting} type="submit">
                {submitting ? "Building plan..." : "Generate Repair Plan"}
              </button>

              <button type="button" className="btn btn-clear" onClick={clearAllInput} disabled={submitting}>
                Clear All Input
              </button>
            </form>

            {error ? <p className="error-text">{error}</p> : null}
            {schemaErrors.length > 0 ? (
              <ul className="schema-errors">
                {schemaErrors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : (
          <section className="plan-wrap">
            <div className="plan-topbar">
              <div>
                <h2>{plan.title}</h2>
                <p className="plan-summary">{plan.simpleSummary}</p>
              </div>

              <div className="plan-controls">
                <button type="button" className="btn btn-reset" onClick={resetPlan}>
                  Start Over
                </button>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={showAllSteps}
                    onChange={(event) => setShowAllSteps(event.target.checked)}
                  />
                  Show all step windows on one scrolling page
                </label>
              </div>
            </div>

            <div className="progress-track" aria-label="Repair step progress">
              <span style={{ width: `${completionPercent}%` }} />
            </div>

            <div className="layout-grid">
              <div className="step-stage-wrap">
                {showAllSteps ? (
                  <div className="step-list-view step-stage step-stage-scroll step-stage-review">
                    {steps.map((step, index) => renderStepCard(step, index, { interactive: true }))}
                  </div>
                ) : (
                  <div className="single-view step-stage">
                    {currentStepIndex > 0
                      ? renderPreviewTitleCard(
                          steps[currentStepIndex - 1],
                          "preview-prev",
                          "Previous step -",
                          "preview-prev-card"
                        )
                      : renderPreviewSpacer("preview-prev-spacer", "preview-prev-card")}
                    {currentStep ? renderStepCard(currentStep, currentStepIndex, { interactive: true }) : null}
                    {currentStepIndex < steps.length - 1
                      ? renderPreviewTitleCard(
                          steps[currentStepIndex + 1],
                          "preview-next",
                          "Next step -",
                          "preview-next-card"
                        )
                      : renderPreviewSpacer("preview-next-spacer", "preview-next-card")}
                  </div>
                )}
              </div>

            </div>
          </section>
        )}

          <div className="status-reserve" aria-live="polite" aria-atomic="true">
            {completedFlow ? (
              <div className="completion-panel completion-panel-docked" role="status">
                <h3>Repair flow complete</h3>
                <div className="completion-actions">
                  <button
                    type="button"
                    className="btn btn-review"
                    onClick={() => {
                      setShowAllSteps(true);
                      goToIndex(0);
                    }}
                  >
                    Review all steps
                  </button>
                  <button
                    type="button"
                    className="btn btn-return"
                    onClick={() => {
                      setShowAllSteps(false);
                      goToIndex(Math.max(0, steps.length - 1));
                    }}
                  >
                    Return to step view
                  </button>
                </div>
              </div>
            ) : submitting ? (
              <div className="processing-status processing-status-docked" role="status">
                <span className="spinner-wheel" aria-hidden="true" />
                <div>
                  <p className="processing-title">Processing request</p>
                  <p className="processing-step">Current status: waiting for real planner response ({submitElapsedSeconds}s elapsed)</p>
                </div>
              </div>
            ) : (
              <div className="processing-status-placeholder" aria-hidden="true" />
            )}
          </div>
        </div>

        <aside className="advertising-lane" aria-label="Advertiser lane placeholder">
          <div className="ad-slot-grid">
            {Array.from({ length: SPONSORED_SLOT_COUNT }, (_, index) => (
              <button
                key={`sponsored-slot-${index + 1}`}
                type="button"
                className="ad-slot"
                onClick={() => onPresetClick(index)}
              >
                <span className="ad-slot-label">Sponsored Link {index + 1}</span>
                {presets[index] ? <span className="ad-slot-status">(preset set)</span> : null}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
