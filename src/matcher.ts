import { GoogleGenAI, Type } from "@google/genai";
import type { RawJob, MatchEvaluation } from "./types.js";

const ai = new GoogleGenAI();

// Models evaluated in sequential order if the previous one fails or hits rate limits
const FREE_MODELS = ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.1-flash-lite"];

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

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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
      const isTransient =
        error?.message?.includes("503") ||
        error?.status === 503 ||
        error?.message?.includes("UNAVAILABLE") ||
        error?.message?.includes("429") ||
        error?.status === 429;

      if (isTransient && attempt < retries) {
        const backoffMs = attempt * 2500;
        console.warn(
          `[${modelName}] Transient API error (${error?.status || 503}). Retrying in ${backoffMs / 1000}s...`,
        );
        await sleep(backoffMs);
      } else {
        // Bubble the error up so evaluateJob can switch to the next fallback model
        throw error;
      }
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

  // Iterate through fallback models sequentially
  for (const modelName of FREE_MODELS) {
    try {
      if (lastError) {
        console.warn(
          `⚠️ Switching fallback to ${modelName} for "${job.title}" due to previous error...`,
        );
      }

      text = await callGeminiWithRetry(prompt, modelName, 2);

      // Successfully received response; exit loop
      if (text) break;
    } catch (err: any) {
      lastError = err;
      console.error(
        `❌ Model ${modelName} failed all retries for "${job.title}": ${err?.message || err}`,
      );
    }
  }

  // If text is still null or empty, all models failed
  if (!text) {
    console.error(
      `All fallback models exhausted for "${job.title}". Last error: ${lastError?.message || lastError}`,
    );
    return null; // Signals index.ts not to mark this job as seen
  }

  try {
    return JSON.parse(text) as MatchEvaluation;
  } catch (parseError) {
    console.error(`Failed to parse JSON response for "${job.title}":`, parseError);
    return null;
  }
}
