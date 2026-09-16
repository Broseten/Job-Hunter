import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RawJob } from "./types.js";

interface PersonaKeywords {
  titleKeywords: string[];
  contentKeywords?: string[];
}

// ----------------------------------------------------------------------
// 1. Language & Content Utilities
// ----------------------------------------------------------------------

/**
 * Fast, zero-dependency English detector.
 * Checks for statistical density of top common English stop-words.
 */
function isLikelyEnglish(text: string): boolean {
  const sample = text.toLowerCase().slice(0, 1500);
  const englishStopWords =
    /\b(the|and|to|of|a|in|is|that|for|you|with|on|as|are|at|be|this|have|from|our|team|experience|we|work|will|skills)\b/g;
  const matches = sample.match(englishStopWords);
  // An English tech posting of 1500 chars will contain dozens of these words
  return (matches?.length || 0) >= 12;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]*>?/gm, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// ----------------------------------------------------------------------
// 2. Individual Job Board Fetchers
// ----------------------------------------------------------------------

/**
 * Fetch from Jobicy (EU Remote, increased count to 100)
 */
async function fetchJobicy(): Promise<RawJob[]> {
  try {
    const res = await fetch("https://jobicy.com/api/v2/remote-jobs?geo=europe&count=100");
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs || []).map((j: any) => ({
      id: `jobicy:${j.id}`,
      title: j.jobTitle.trim(),
      company: j.companyName.trim(),
      url: j.url,
      description: cleanHtml(j.jobDescription || "").slice(0, 4500),
    }));
  } catch (err) {
    console.warn("⚠️ Jobicy fetch failed:", err);
    return [];
  }
}

/**
 * Fetch from Remotive (Software Dev category, filter by Europe/Worldwide)
 */
async function fetchRemotive(): Promise<RawJob[]> {
  try {
    const res = await fetch("https://remotive.com/api/remote-jobs?category=software-dev&limit=100");
    if (!res.ok) return [];
    const data = await res.json();

    const euLocationRegex =
      /europe|eu|emea|worldwide|anywhere|remote|uk|germany|france|czech|netherlands|poland/i;

    return (data.jobs || [])
      .filter((j: any) => euLocationRegex.test(j.candidate_required_location || ""))
      .map((j: any) => ({
        id: `remotive:${j.id}`,
        title: j.title.trim(),
        company: j.company_name.trim(),
        url: j.url,
        description: cleanHtml(j.description || "").slice(0, 4500),
      }));
  } catch (err) {
    console.warn("⚠️ Remotive fetch failed:", err);
    return [];
  }
}

/**
 * Fetch from Arbeitnow (EU tech board with remote tags)
 */
async function fetchArbeitnow(): Promise<RawJob[]> {
  try {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
    if (!res.ok) return [];
    const data = await res.json();

    return (data.data || [])
      .filter((j: any) => j.remote === true)
      .map((j: any) => ({
        id: `arbeitnow:${j.slug}`,
        title: j.title.trim(),
        company: j.company_name.trim(),
        url: j.url,
        description: cleanHtml(j.description || "").slice(0, 4500),
      }));
  } catch (err) {
    console.warn("⚠️ Arbeitnow fetch failed:", err);
    return [];
  }
}

// ----------------------------------------------------------------------
// 3. Central Aggregator & Deduplication
// ----------------------------------------------------------------------

let cachedJobsPool: RawJob[] | null = null;

/**
 * Fetches all job boards simultaneously, deduplicates identical jobs
 * posted across multiple boards, and filters for English-only listings.
 */
export async function fetchAllRemoteEUJobs(forceRefresh = false): Promise<RawJob[]> {
  if (cachedJobsPool && !forceRefresh) {
    return cachedJobsPool;
  }

  console.log("📡 Querying job boards (Jobicy, Remotive, Arbeitnow)...");

  const [jobicyJobs, remotiveJobs, arbeitnowJobs] = await Promise.all([
    fetchJobicy(),
    fetchRemotive(),
    fetchArbeitnow(),
  ]);

  const allRaw = [...jobicyJobs, ...remotiveJobs, ...arbeitnowJobs];
  console.log(`📥 Total jobs pulled across portals: ${allRaw.length}`);

  // Deduplicate across portals (same company + normalized title)
  const uniqueKeyMap = new Map<string, RawJob>();
  for (const job of allRaw) {
    const dedupKey = `${job.company.toLowerCase().replace(/[^a-z0-9]/g, "")}:${job.title.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    if (!uniqueKeyMap.has(dedupKey)) {
      uniqueKeyMap.set(dedupKey, job);
    }
  }

  // Filter out non-English job descriptions
  const englishJobs = Array.from(uniqueKeyMap.values()).filter((job) =>
    isLikelyEnglish(job.description + " " + job.title),
  );

  console.log(`🇬🇧 English & unique listings remaining: ${englishJobs.length}`);
  cachedJobsPool = englishJobs;
  return englishJobs;
}

// ----------------------------------------------------------------------
// 4. Persona Matching (Title OR Content)
// ----------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Filters the job pool using both titleKeywords and contentKeywords.
 *
 * Logic:
 * 1. Matches if title contains any `titleKeywords`.
 * 2. OR Matches if description contains any `contentKeywords`.
 */
export async function filterJobsForPersona(
  jobs: RawJob[],
  personaFolder: string,
): Promise<RawJob[]> {
  const filePath = resolve(process.cwd(), "profiles", personaFolder, "keywords.json");

  let persona: PersonaKeywords;
  try {
    const rawData = await readFile(filePath, "utf-8");
    persona = JSON.parse(rawData);
  } catch (err) {
    console.warn(`Could not load keywords.json for "${personaFolder}". Using fallback.`, err);
    persona = {
      titleKeywords: ["developer", "engineer", "software"],
    };
  }

  const titleRegex = new RegExp(persona.titleKeywords.map(escapeRegex).join("|"), "i");

  const contentRegex =
    persona.contentKeywords && persona.contentKeywords.length > 0
      ? new RegExp(persona.contentKeywords.map(escapeRegex).join("|"), "i")
      : null;

  return jobs.filter((job) => {
    // 1. Direct hit in title
    if (titleRegex.test(job.title)) return true;

    // 2. Hit in content/body (catches generic titles like "Senior Engineer" that need your exact stack)
    if (contentRegex && contentRegex.test(job.description)) {
      return true;
    }

    return false;
  });
}
