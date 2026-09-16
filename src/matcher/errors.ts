/**
 * Safely trims boundary punctuation while preserving internal version dots.
 */
export function cleanModelName(raw: string): string {
  return raw
    .replace(/^models\//, "")
    .replace(/^['"`(]+|['"`.,;:)]+$/g, "")
    .trim();
}

/**
 * Parses Gemini error payloads to see if Google suggested a newer model.
 */
export function extractSuggestedModel(error: any, currentModel: string): string | null {
  const message = error?.message || (typeof error === "string" ? error : "");
  if (!message) return null;

  // Pattern 1: Direct recommendation
  const directMatch = message.match(
    /(?:use|try|switch to|upgrade to|migrate to|replaced by|recommend(?:ed)? to)\s+['"`]?(?:models\/)?(gemini-[\w.-]+)/i,
  );
  if (directMatch && directMatch[1]) {
    const candidate = cleanModelName(directMatch[1]);
    if (candidate && candidate !== currentModel) return candidate;
  }

  // Pattern 2: Mentioned in a valid/supported list
  const listMatch = message.match(
    /(?:valid|supported|available)\s+models?\s+(?:are|include)?\s*[:\[]?\s*(?:models\/)?(gemini-[\w.-]+)/i,
  );
  if (listMatch && listMatch[1]) {
    const candidate = cleanModelName(listMatch[1]);
    if (candidate && candidate !== currentModel) return candidate;
  }

  // Pattern 3: Any other Flash model token
  const anyFlashMatch = message.match(
    /\b(?:models\/)?(gemini-\d+(?:\.\d+)?[\w.-]*flash[\w.-]*)\b/gi,
  );
  if (anyFlashMatch) {
    for (const raw of anyFlashMatch) {
      const candidate = cleanModelName(raw);
      if (candidate && candidate !== currentModel) return candidate;
    }
  }

  return null;
}

/**
 * Extracts explicit retry countdown (seconds) or defaults to 60s.
 */
export function extractRetryDelayMs(error: any, defaultMs = 60_000): number {
  const message = error?.message || (typeof error === "string" ? error : "");
  const match = message.match(/retry in\s+([\d.]+)\s*s/i);
  if (match && match[1]) {
    const seconds = parseFloat(match[1]);
    if (!Number.isNaN(seconds)) {
      return Math.ceil(seconds * 1000) + 1500; // 1.5s safe buffer
    }
  }
  return defaultMs;
}

export function isPermanentModelError(error: any): boolean {
  const msg = (error?.message || "").toLowerCase();
  const status = error?.status;
  return (
    status === 404 ||
    status === "NOT_FOUND" ||
    msg.includes("not found") ||
    msg.includes("deprecated") ||
    msg.includes("discontinued") ||
    msg.includes("no longer supported") ||
    msg.includes("shut down")
  );
}

export function isRateLimitError(error: any): boolean {
  const msg = (error?.message || "").toLowerCase();
  const status = error?.status;
  return (
    status === 429 ||
    status === "RESOURCE_EXHAUSTED" ||
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota exceeded")
  );
}

export function isServerError(error: any): boolean {
  const msg = (error?.message || "").toLowerCase();
  const status = error?.status;
  return (
    status === 503 ||
    status === "UNAVAILABLE" ||
    msg.includes("503") ||
    msg.includes("unavailable")
  );
}