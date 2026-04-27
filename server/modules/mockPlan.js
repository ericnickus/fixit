function issueTitle(intake) {
  const base = `${intake.deviceType || "Appliance"} Repair Plan`;
  if (!intake.symptom) {
    return base;
  }

  return `${base}: ${intake.symptom.slice(0, 68)}`;
}

function quickSummary(intake) {
  return `Goal: ${intake.repairGoal}. Symptom focus: ${intake.symptom}. Steps are ordered for safety first, then fastest diagnostic confidence.`;
}

export function buildMockPlan(intake, options = {}) {
  const reason = options.reason ? ` (${options.reason})` : "";

  return {
    title: issueTitle(intake),
    simpleSummary: `${quickSummary(intake)} Fallback template in use${reason}.`,
    partsNeeded: [
      "Work light or flashlight",
      "Basic screwdriver set",
      "Needle-nose pliers",
      "Multimeter if available"
    ],
    toolSuggestions: [
      "Use leverage, not force, when loosening seized fasteners.",
      "Grip wrench near the end for more torque and steadier control.",
      "Label removed screws by step order to avoid reverse-fit mistakes.",
      "Unplug power and isolate water or gas before touching internal components."
    ],
    steps: [
      {
        id: "step_1",
        title: "Isolate power and access panel safely",
        action: "Unplug the unit, confirm no live power, and open the easiest service panel.",
        whyImportant: "This prevents shock risk and gives a safe baseline before diagnostics.",
        caution: "Never probe internal wiring while energized.",
        doneCheck: "Panel is open and work area is stable with clear visibility.",
        fallbackAction: "If access is blocked, reposition appliance and retry with a helper.",
        failedNextId: null,
        tools: ["Flashlight", "Screwdriver"]
      },
      {
        id: "step_2",
        title: "Recreate symptom under controlled conditions",
        action: "Run the shortest safe cycle and note exact failure moment, sound, and smell.",
        whyImportant: "Precise timing narrows likely subsystems quickly.",
        caution: "Stop immediately if smoke, arcing, or gas odor appears.",
        doneCheck: "You can state exactly when the fault begins.",
        fallbackAction: "If symptom does not reproduce, check recent user changes and retry.",
        failedNextId: null,
        tools: ["Phone timer", "Notepad"]
      },
      {
        id: "step_3",
        title: "Inspect the highest-probability failure path",
        action: "Check connectors, hoses, or drive components linked to the symptom for looseness, kinks, or wear.",
        whyImportant: "Most home-repair issues are physical disruptions before board failures.",
        caution: "Do not force brittle clips or aged plastic tabs.",
        doneCheck: "One concrete defect or clear pass result is documented.",
        fallbackAction: "If no defect found, move to electrical continuity checks.",
        failedNextId: "step_4",
        tools: ["Needle-nose pliers", "Inspection mirror"]
      },
      {
        id: "step_4",
        title: "Perform targeted electrical or flow validation",
        action: "Use a multimeter or flow check at one suspect component only, then retest.",
        whyImportant: "Single-variable testing avoids false conclusions.",
        caution: "Only test with proper meter settings and insulated leads.",
        doneCheck: "Reading confirms pass/fail for the selected component.",
        fallbackAction: "If readings are inconclusive, test upstream supply path next.",
        failedNextId: null,
        tools: ["Multimeter", "Insulated probes"]
      },
      {
        id: "step_5",
        title: "Apply fix and verify full cycle",
        action: "Tighten, clean, or replace the failed part, then run one complete test cycle.",
        whyImportant: "A complete cycle confirms durable recovery, not temporary behavior.",
        caution: "Reinstall all shields and strain relief before final run.",
        doneCheck: "The original symptom is gone through a full cycle.",
        fallbackAction: "If symptom persists, branch to advanced assist with photo context.",
        failedNextId: null,
        tools: ["Replacement part if required"]
      }
    ]
  };
}
