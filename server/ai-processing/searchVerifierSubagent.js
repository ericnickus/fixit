function sanitizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return sanitizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function overlapScore(stepTokens, evidenceText) {
  if (!stepTokens.length) {
    return 0.5;
  }

  const evidenceSet = new Set(tokenize(evidenceText));
  let matches = 0;

  for (const token of stepTokens) {
    if (evidenceSet.has(token)) {
      matches += 1;
    }
  }

  const ratio = matches / stepTokens.length;
  return Number(Math.min(0.99, Math.max(0.05, ratio)).toFixed(4));
}

async function searchDuckDuckGo(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "FixityerselfVerifier/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}`);
  }

  const html = await response.text();
  const snippets = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((match) => sanitizeText(match[1]))
    .filter(Boolean)
    .slice(0, 6);

  if (snippets.length === 0) {
    const fallbackSnippets = [...html.matchAll(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/g)]
      .map((match) => sanitizeText(match[1]))
      .filter(Boolean)
      .slice(0, 6);

    return fallbackSnippets;
  }

  return snippets;
}

/**
 * Search-verifier subagent computes internet parity scores per step.
 */
export async function runSearchVerifierSubagent({ intake, steps }) {
  const device = intake.deviceType || "appliance";
  const symptom = intake.symptom || "repair issue";
  const results = [];

  for (const step of steps) {
    const stepTokens = tokenize(`${step.title} ${step.action} ${step.fallbackAction}`);
    const query = `${device} ${symptom} ${step.action} successful fix`;

    try {
      const snippets = await searchDuckDuckGo(query);
      const combinedEvidence = snippets.join(" ");
      const score = overlapScore(stepTokens, combinedEvidence);

      results.push({
        stepId: step.id,
        resultScore: score,
        evidence: snippets.slice(0, 2)
      });
    } catch {
      results.push({
        stepId: step.id,
        resultScore: 0.5,
        evidence: ["Search parity unavailable in this run; using neutral score."]
      });
    }
  }

  return results;
}
