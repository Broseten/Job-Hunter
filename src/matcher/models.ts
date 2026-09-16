import type { GoogleGenAI } from "@google/genai";

export const DEFAULT_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-3.1-flash-lite",
];

export const activeModels: string[] = [...DEFAULT_MODELS];
export const deprecatedModels = new Set<string>();

/**
 * Move successful model to position 0 to prioritize it for future calls.
 */
export function promoteModel(modelName: string): void {
  const index = activeModels.indexOf(modelName);
  if (index > 0) {
    activeModels.splice(index, 1);
    activeModels.unshift(modelName);
  } else if (index === -1) {
    activeModels.unshift(modelName);
  }
}

/**
 * Queries Gemini API directly if all hardcoded models fail.
 */
export async function fetchAvailableFlashModels(ai: GoogleGenAI): Promise<string[]> {
  try {
    const listResult = await ai.models.list();
    const candidateModels: { name: string; version: number }[] = [];
    const items: any[] = [];

    if (listResult && typeof (listResult as any)[Symbol.asyncIterator] === "function") {
      for await (const m of listResult as any) items.push(m);
    } else if (Array.isArray((listResult as any)?.data)) {
      items.push(...(listResult as any).data);
    } else if (Array.isArray(listResult)) {
      items.push(...listResult);
    }

    for (const m of items) {
      const modelId = (m?.name || "").replace(/^models\//, "");
      const isFlash = modelId.toLowerCase().includes("flash");
      const isSpecialized =
        modelId.includes("image") ||
        modelId.includes("tts") ||
        modelId.includes("live") ||
        modelId.includes("transcribe") ||
        modelId.includes("embedding");

      if (isFlash && !isSpecialized) {
        const verMatch = modelId.match(/gemini-(\d+(?:\.\d+)?)/i);
        candidateModels.push({
          name: modelId,
          version: verMatch ? parseFloat(verMatch[1]) : 0,
        });
      }
    }

    candidateModels.sort((a, b) => b.version - a.version);
    return candidateModels.map((m) => m.name);
  } catch (err) {
    console.warn("⚠️ Could not list live models via ai.models.list():", err);
    return [];
  }
}