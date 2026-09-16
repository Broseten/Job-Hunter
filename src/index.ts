import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { fetchAllRemoteEUJobs, filterJobsForPersona } from "./fetchJobs.js";
import { filterUnseenJobs, markJobAsSeen } from "./storage.js";
import { evaluateJob } from "./matcher.js";
import { sendDiscordNotification } from "./notifier.js";

const PERSONAS = ["simulation", "agentic", "creative-rd"];
const SCORE_THRESHOLD = 65;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function run() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env");
    process.exit(1);
  }

  // 1. Fetch from all sources once and normalize
  const allAvailableJobs = await fetchAllRemoteEUJobs();

  for (const persona of PERSONAS) {
    console.log(`\n==================================================`);
    console.log(`🎯 Processing Persona: ${persona.toUpperCase()}`);
    console.log(`==================================================`);

    const profilePath = path.resolve(process.cwd(), "profiles", persona, "profile.md");
    if (!fs.existsSync(profilePath)) {
      console.warn(`⚠️ profile.md not found at "${profilePath}". Skipping persona.`);
      continue;
    }
    const candidateProfile = fs.readFileSync(profilePath, "utf-8");

    // 2. Filter pool by persona's title and content keywords
    const personaMatchedJobs = await filterJobsForPersona(allAvailableJobs, persona);
    console.log(`Found ${personaMatchedJobs.length} candidate roles for "${persona}".`);

    // 3. Scope ID by persona
    const scopedJobs = personaMatchedJobs.map((job) => ({
      ...job,
      id: `${persona}:${job.id}`,
    }));

    // 4. Exclude previously seen jobs
    const unseenJobs = filterUnseenJobs(scopedJobs);
    console.log(`${unseenJobs.length} unseen postings to analyze with AI.`);

    if (unseenJobs.length === 0) continue;

    // 5. Evaluate with Gemini
    for (const job of unseenJobs) {
      console.log(`Analyzing: ${job.title} @ ${job.company}...`);
      const evaluation = await evaluateJob(candidateProfile, job);

      if (!evaluation) {
        console.warn(`Skipping seen state for "${job.title}"; will retry on next run.`);
        continue;
      }

      markJobAsSeen(job.id);

      if (evaluation.matchScore >= SCORE_THRESHOLD) {
        console.log(`🔥 Match (${evaluation.matchScore}/100): ${job.title} @ ${job.company}`);
        await sendDiscordNotification(persona, job, evaluation);
      }

      await sleep(1500); // Respect free-tier rate limit
    }
  }

  console.log("\nPipeline finished!");
}

run();
