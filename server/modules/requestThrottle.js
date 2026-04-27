export function createRequestThrottle({ cooldownSeconds = 20 } = {}) {
  const lastSeenByKey = new Map();
  const cooldownMs = Number(cooldownSeconds) * 1000;

  return {
    checkAndMark(key, now = Date.now()) {
      const safeKey = String(key || "anonymous");
      const previous = lastSeenByKey.get(safeKey);

      if (previous !== undefined && now - previous < cooldownMs) {
        const remainingMs = cooldownMs - (now - previous);
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(remainingMs / 1000)
        };
      }

      lastSeenByKey.set(safeKey, now);

      return {
        allowed: true,
        retryAfterSeconds: 0
      };
    }
  };
}
