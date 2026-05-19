# Fixityerself v2 Prototype

React + Express app for structured repair intake, high-signal prompt generation, strict low-noise response cleanup, and step-level telemetry.

## What this build includes

- Structured intake form to preserve detailed context while reducing low-signal chat noise.
- ChatGPT API agent bridge (`/api/repair-plan`) with strict JSON schema instructions.
- Root-level runtime config (`fixity.config.json`) with explicit mode selection and option listing:
  - `mode`: `UserMode` or `SubagentMode`
  - `modeOptions`: listed allowed values
  - `runModeSettings`: global controls for prompt cooldown and safety, including prompt cooldown seconds
  - `SubagentMode`: testing profile for `gpt-4.1-mini`
  - `UserMode`: mode profile for `gpt-5-mini`
- Prompt rate blocking is config-driven via `runModeSettings.promptCooldownSeconds`.
- Prompt safety gate before AI submission:
  - blocks harmful requests
  - normalizes code snippets to plain text before prompting
- Multi-pass output conform pipeline:
  - pass 1 content generation
  - pass 2 formatting/conform generation
  - final deterministic machine-pass normalization and compliance checks
  - forced retweak attempts when compliance fails
  - if compliance still fails, full rerun starts again from pass 1 with failure context
  - up to 3 full runs total; third run is accepted as best effort if still non-compliant
- Step UI with two display modes:
  - Scroll mode: all step windows/buttons in one continuous page.
  - Focus mode: one main step with previous/next review previews at 75% size and 25% dimmer appearance.
- Done/Did Not Work buttons for every actionable step.
- Last-step review button that returns to step 1 in scrolling mode.
- Persistent telemetry store (`data/stepMetrics.json`) to weight step viability over time.
- Persistent memory store (`data/agentMemory.json`) that learns recurring high-value tool suggestions.
- Advanced-assist placeholder block when a step fails multiple times.
- Per-step dual scoring:
  - `user score`: internal success parity from done/failed outcomes.
  - `result score`: internet parity from search verifier evidence.

## Install and run

1. Install Node.js 20+ (required).
2. In this folder run:

```bash
npm install
npm run dev
```

Create a `.env` file in the project root with:

```bash
OPENAI_API_KEY=your_key_here
```

- Frontend runs on `http://localhost:5173`.
- Backend runs on `http://localhost:8787`.

## Programmer start methods

### One-push startup (recommended)

```bash
npm run launch
```

Expected result:

- The launcher auto-selects free ports starting from frontend `5173` and backend `8787`.
- If either port is busy, it moves up to the next available port automatically.
- Browser opens automatically to the selected frontend URL.
- Terminal prints the exact frontend and backend URLs.
- Press `Ctrl+C` to stop both services; launcher shuts down child processes and releases ports.

### Command-file startup (macOS)

- Double-click `launch_fixityerself.command`
- Or run from terminal:

```bash
./launch_fixityerself.command
```

Expected browser window:

- A Fixityerself page with the intake form, including `Repair goal (main symptoms)` as the first field.

If `OPENAI_API_KEY` is missing, `/api/repair-plan` returns an error (no mock fallback mode).

## Runtime config example

```json
{
  "mode": "UserMode",
  "modeOptions": ["UserMode", "SubagentMode"],
  "runModeSettings": {
    "promptCooldownSeconds": 20,
    "safetyBlockingEnabled": true,
    "normalizeCodeToText": true
  },
  "SubagentMode": {
    "plannerPath": "agent-run-subagent",
    "lowCostModel": "gpt-4.1-mini",
    "enableSearchVerifier": true,
    "searchSource": "duckduckgo-html"
  },
  "UserMode": {
    "plannerPath": "runtime-user",
    "lowCostModel": "gpt-5-mini",
    "enableSearchVerifier": true,
    "searchSource": "duckduckgo-html"
  }
}
```

## Test commands

```bash
npm test
npm run build
```

## API endpoints

- `POST /api/repair-plan`:
  - Input: structured intake fields from the React form.
  - Output: normalized JSON with title, summary, parts, tool suggestions, and steps including `userScore` and `resultScore`.
- `POST /api/step-event`:
  - Input: step button events (`done` or `failed`) with session/issue fingerprint.
  - Output: current viability snapshot for that step key.
- `GET /api/metrics`:
  - Output: strongest/toughest steps and recent events.

## Thorough analysis matrix for repair question normalization

This prototype maps user questions into high-signal categories before prompting the model:

1. Power Delivery:
- Typical user asks: will not start, dead panel, breaker trips.
- Required normalized data: outlet state, breaker behavior, startup sequence timing.
- Cleanup rule: remove generic electrical education; keep exact fault timing and reset attempts.

2. Water Flow:
- Typical user asks: leaks, no fill, no drain, overflow.
- Required normalized data: leak location, cycle stage, hose routing, standing water evidence.
- Cleanup rule: remove broad plumbing info; keep direction of flow and obstruction details.

3. Heat/Cooling:
- Typical user asks: not heating, overheating, weak cooling.
- Required normalized data: temperature behavior over time, airflow state, smell clues.
- Cleanup rule: remove thermal theory; keep timing, vent status, and safety notes.

4. Mechanical Motion:
- Typical user asks: grinding, vibration, no spin, stalls.
- Required normalized data: motion onset, load condition, belt/pulley behavior.
- Cleanup rule: remove general mechanics talk; keep exact noise pattern and movement failures.

5. Controls/Sensors:
- Typical user asks: error code loops, resets, display faults.
- Required normalized data: code recurrence, trigger pattern, sensor/connector handling.
- Cleanup rule: remove generalized electronics discussion; keep code text and event sequence.

## Prompt strategy used in this build

- Preserve all user details and constraints.
- Reject low-signal response content:
  - history
  - broad educational overviews
  - non-actionable generic guidance
- Use a two-pass model strategy:
  - Pass 1 for content quality and branch completeness.
  - Pass 2 for strict formatting/conformance.
- Demand plain-language but technically precise actions.
- Add memory-derived tool-use hints from prior successful plans.

## Prompt sanitizing summary

Input handling before model call is deterministic and runs in this order:

1. Schema validation:
- The request body is parsed with zod. Required fields must be present and non-empty where required.
- Invalid payloads return HTTP 400 immediately.

2. Code-to-plain-text normalization (when enabled):
- Triple-backtick blocks are flattened to plain text.
- Inline backticks are removed.
- Angle brackets are stripped to spaces.
- Repeated whitespace is collapsed.
- This normalization runs over all string fields.

3. Safety blocking (when enabled):
- A corpus is built from all string intake fields.
- Regex blockers reject known harmful classes:
  - weaponization
  - malware/cyberattack
  - self-harm
  - violent-harm instruction
- Blocked input returns HTTP 400 with `blockId` and reason; no model call is made.

4. Prompt-rate control:
- One prompt per session key every 20 seconds by default.
- Cooldown is configured through `runModeSettings.promptCooldownSeconds`.
- If exceeded, API returns HTTP 429 and `retryAfterSeconds`.

5. Prompt construction:
- Intake is transformed into a high-signal block.
- Diagnostic tracks are inferred from symptom keywords.
- Prior successful tool hints are injected from memory.
- System prompt enforces strict JSON and requests prep-path dual options:
  - tools: best and hack
  - budget: best and hack
- Returned repair steps are requested as actionable steps after prep confirmations.

## AI output conform summary

Model output is conformed into deterministic app state in this order:

1. Content pass (AI):
- The model generates high-signal draft content with complete repair logic and options.

2. Formatting pass (AI):
- A second model pass transforms the draft into strict schema-compliant JSON.
- This pass is constrained by the schema and cleanup requirements from promptBuilder.

3. Machine extraction/parse:
- Parse full text as JSON.
- If that fails, extract the outermost JSON object and parse again.
- If still invalid, throw error.

4. Step normalization (machine):
- Each raw step is mapped to normalized fields:
  - `id`, `title`, `action`, `alternateAction`, `whyImportant`, `caution`, `doneCheck`, `fallbackAction`, `failedNextId`, `tools`
- Missing values are filled with safe defaults.
- Low-signal filler phrases are removed unless detail-heavy technical content is present.

5. Prep-path normalization (machine):
- `prepPaths.tools.best/hack` and `prepPaths.budget.best/hack` are normalized.
- Missing prep paths are filled with deterministic defaults.

6. Top-level normalization (machine):
- `title`, `simpleSummary`, `partsNeeded`, `toolSuggestions` are sanitized and bounded.
- Tool suggestions merge model tips, step-tool hints, and memory hints.

7. Compliance enforcement + forced retweaks:
- A deterministic compliance validator checks required top-level fields, prep paths, and step-level schema completeness.
- If compliance fails, the formatter pass is forced to retweak using explicit compliance errors.
- Retweaks repeat for a bounded retry count.
- If still non-compliant, the pipeline reruns from content pass with compliance context.
- Pipeline can rerun up to 3 times total.
- If the third full run is still non-compliant but parseable, that third run is accepted as best effort.

8. Scoring enrichment:
- `userScore` is attached per step from historical done/failed telemetry.
- `resultScore` is attached from search-parity verifier evidence.
- `combinedScore` and `scoreBand` are computed per step.

9. UI step orchestration:
- UI prep step 1: tool-path confirmation (best first, hack path as alternate).
- UI prep step 2: budget-path confirmation (best first, hack path as alternate).
- Model-provided steps are shown as actionable path from step 3 onward.
- `Try Something Else` enables alternate path mode and uses each step's `alternateAction` where available.

10. Error behavior (no fallback mode):
- Missing API key: HTTP 503, no plan generated.
- Generation exception that never yields parseable plan output: HTTP 500, no fallback plan generated.

## Conform fail telemetry

- Per request, the backend logs pipeline-run failure count and whether third-run forced acceptance was used.
- Aggregated stats are persisted in `data/conformStats.json`.
- Rolling metric tracked: `averagePipelineRunFailuresPerRequest`.
- This metric is returned in `/api/repair-plan` response as `conformStats` and in `/api/metrics` under `conformStats`.

## Viability weighting model

Each step key tracks `done` and `failed` counts and computes viability using Laplace smoothing:

`viability = (done + 1) / (done + failed + 2)`

This avoids unstable scores for low-volume data while surfacing weak steps for future improvement.

## Key files

- `fixity.config.json` - root-level runtime route for self-test planner mode.

- `src/App.jsx` - structured intake + dual mode step UI + button event hooks.
- `src/styles.css` - responsive visual design and preview styling behavior.
- `server/server.js` - API endpoints, OpenAI bridge, and runtime error handling.
- `server/modules/promptBuilder.js` - intake analysis and high-signal prompt construction.
- `server/modules/responseCleaner.js` - cleanup and normalization of model output.
- `server/modules/conformCompliance.js` - deterministic output compliance checks used before accepting model output.
- `server/modules/conformStats.js` - persistent request-level conform failure stats and average failure tracking.
- `server/modules/selfMemory.js` - persistent memory for useful tool hints.
- `server/modules/stepMetrics.js` - button telemetry and viability scoring.
- `goals.md` - tuning goals including request fail average strictness guidance.
