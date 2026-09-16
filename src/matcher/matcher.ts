import { GoogleGenAI, Type } from "@google/genai";
import type { RawJob, MatchEvaluation } from "../types.js";
import {
  cleanModelName,
  extractSuggestedModel,
  extractRetryDelayMs,
  isPermanentModelError,
  isRateLimitError,
  isServerError,
} from "./errors.js";
import {
  activeModels,
  deprecatedModels,
  promoteModel,
  fetchAvailableFlashModels,
} from "./models.js";

const ai = new GoogleGenAI();
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    matchScore: { type: Type.INTEGER, description: "Compatibility score from 0 to 100" },
    verdict: { type: Type.STRING, enum: ["Strong Match", "Moderate Match", "Skip"] },
    keyMatches: { type: Type.ARRAY, items: { type: Type.STRING } },
    potentialGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
    summary: { type: Type.STRING, description: "1-2 sentence executive verdict" },
  },
  required: ["matchScore", "verdict", "keyMatches", "potentialGaps", "summary"],
};

async function callGeminiWithRetry(
  prompt: string,
  modelName: string,
  retries = 2,
): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction:
            "You are an expert technical recruiter. Strictly evaluate candidate qualifications against job requirements. Penalize missing required core technologies or mismatched seniority.",
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        },
      });

      return response.text || null;
    } catch (error: any) {
      if (isPermanentModelError(error)) throw error;

      const isRateLimited = isRateLimitError(error);
      const isTransient = isServerError(error);

      if ((!isRateLimited && !isTransient) || attempt >= retries) {
        throw error;
      }

      const waitMs = isRateLimited ? extractRetryDelayMs(error, 60_000) : attempt * 3000;

      console.warn(
        `⏳ [${modelName}] ${isRateLimited ? "Rate limit" : "Server issue"} (Attempt ${attempt}/${retries}). Retrying in ${(waitMs / 1000).toFixed(1)}s...`,
      );

      await sleep(waitMs);
    }
  }
  return null;
}

export async function evaluateJob(
  candidateProfile: string,
  job: RawJob,
): Promise<MatchEvaluation | null> {
  const prompt = `
Candidate Profile (me):
${candidateProfile}

Job Listing:
Role: ${job.title} at ${job.company}
Description:
${job.description}
`;

  let text: string | null = null;
  let lastError: any = null;
  const modelsToTry = [...activeModels].filter((m) => !deprecatedModels.has(m));

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelName = modelsToTry[i];
    if (!modelName) continue;

    try {
      if (lastError) {
        console.warn(`🔄 Switching to next candidate model "${modelName}" for "${job.title}"...`);
      }

      text = await callGeminiWithRetry(prompt, modelName, 2);
      if (text) {
        promoteModel(modelName);
        break;
      }
    } catch (err: any) {
      lastError = err;

      const suggestedModel = extractSuggestedModel(err, modelName);
      if (
        suggestedModel &&
        !deprecatedModels.has(suggestedModel) &&
        !modelsToTry.includes(suggestedModel)
      ) {
        console.warn(`💡 API suggested model "${suggestedModel}". Queuing immediately...`);
        modelsToTry.splice(i + 1, 0, suggestedModel);
        activeModels.unshift(suggestedModel);
      }

      if (isPermanentModelError(err)) {
        deprecatedModels.add(modelName);
        console.warn(`🚫 Model "${modelName}" retired/unsupported. Blacklisted.`);
      }
    }
  }

  // Dynamic discovery fallback if hardcoded models fail
  if (!text) {
    console.warn("⚠️ All local models failed. Discovering models from API...");
    const discovered = await fetchAvailableFlashModels(ai);
    const freshCandidates = discovered.filter(
      (m) => !deprecatedModels.has(m) && !modelsToTry.includes(m),
    );

    for (const freshModel of freshCandidates) {
      try {
        console.info(`🔍 Trying discovered model "${freshModel}"...`);
        text = await callGeminiWithRetry(prompt, freshModel, 2);
        if (text) {
          promoteModel(freshModel);
          break;
        }
      } catch (err: any) {
        lastError = err;
        if (isPermanentModelError(err)) deprecatedModels.add(freshModel);
      }
    }
  }

  if (!text) {
    console.error(
      `⛔ All models exhausted for "${job.title}". Last error: ${lastError?.message || lastError}`,
    );
    return null;
  }

  try {
    return JSON.parse(text) as MatchEvaluation;
  } catch (parseError) {
    console.error(`Failed to parse JSON response for "${job.title}":`, parseError);
    return null;
  }
}
