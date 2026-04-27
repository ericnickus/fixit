# Fixityerself v2 Prototype

React + Express app for structured repair intake, high-signal prompt generation, strict low-noise response cleanup, and step-level telemetry.

## What this build includes

- Structured intake form to preserve detailed context while reducing low-signal chat noise.
- ChatGPT API agent bridge (`/api/repair-plan`) with strict JSON schema instructions.
- Root-level runtime config (`fixity.config.json`) with explicit mode selection and option listing:
  - `mode`: `selfTest` or `UserMode`
  - `modeOptions`: listed allowed values
  - `runModeSettings`: global controls for prompt cooldown and safety
  - `selfTest`: mode profile for `gpt-4.1-mini`
  - `UserMode`: mode profile for `gpt-5-mini`
- Strict runtime enforcement for generation:
  - planner path must be `agent-run-subagent`
  - generation model must match active mode (`gpt-4.1-mini` in `selfTest`, `gpt-5-mini` in `UserMode`)
  - fallback generation can be disabled (`allowMockFallback: false`)
- Prompt rate blocking: one repair prompt per session every 20 seconds (configurable).
- Prompt safety gate before AI submission:
  - blocks harmful requests
  - normalizes code snippets to plain text before prompting
- Response sanitizer that removes broad/general filler while retaining concrete details.
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
cp .env.example .env
npm run dev
```

- Frontend runs on `http://localhost:5173`.
- Backend runs on `http://localhost:8787`.

If `OPENAI_API_KEY` is missing, the backend automatically uses a fallback mock plan so UI and button telemetry can still be tested.

In strict mode (`allowMockFallback: false`), missing `OPENAI_API_KEY` returns a hard error for `/api/repair-plan` instead of generating mock plans.

## Runtime config example

```json
{
  "mode": "selfTest",
  "modeOptions": ["selfTest", "UserMode"],
  "runModeSettings": {
    "promptCooldownSeconds": 20,
    "safetyBlockingEnabled": true,
    "normalizeCodeToText": true
  },
  "selfTest": {
    "plannerPath": "agent-run-subagent",
    "lowCostModel": "gpt-4.1-mini",
    "strictSubagent": true,
    "allowMockFallback": false,
    "enableSearchVerifier": true,
    "searchSource": "duckduckgo-html"
  },
  "UserMode": {
    "plannerPath": "agent-run-subagent",
    "lowCostModel": "gpt-5-mini",
    "strictSubagent": true,
    "allowMockFallback": false,
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
- Force strict JSON output shape with branch-capable steps.
- Demand plain-language but technically precise actions.
- Add memory-derived tool-use hints from prior successful plans.

## Viability weighting model

Each step key tracks `done` and `failed` counts and computes viability using Laplace smoothing:

`viability = (done + 1) / (done + failed + 2)`

This avoids unstable scores for low-volume data while surfacing weak steps for future improvement.

## Key files

- `fixity.config.json` - root-level runtime route for self-test planner mode.

- `src/App.jsx` - structured intake + dual mode step UI + button event hooks.
- `src/styles.css` - responsive visual design and preview styling behavior.
- `server/server.js` - API endpoints, OpenAI bridge, and fallback handling.
- `server/modules/promptBuilder.js` - intake analysis and high-signal prompt construction.
- `server/modules/responseCleaner.js` - cleanup and normalization of model output.
- `server/modules/selfMemory.js` - persistent memory for useful tool hints.
- `server/modules/stepMetrics.js` - button telemetry and viability scoring.
