import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveHistoryFilePath(filePath) {
  const candidate = String(filePath || "").trim();
  if (!candidate) {
    return path.resolve(__dirname, "../../data/requestHistory.jsonl");
  }

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(__dirname, "../../", candidate);
}

export function createRequestHistoryLogger({ enabled = false, filePath } = {}) {
  const resolvedPath = resolveHistoryFilePath(filePath);

  return {
    enabled: Boolean(enabled),
    filePath: resolvedPath,
    async log(entry) {
      if (!enabled) {
        return;
      }

      try {
        await mkdir(path.dirname(resolvedPath), { recursive: true });
        const payload = {
          timestamp: new Date().toISOString(),
          ...entry
        };
        await appendFile(resolvedPath, `${JSON.stringify(payload)}\n`, "utf8");
      } catch {
        // Logging failures must never block runtime request processing.
      }
    }
  };
}
