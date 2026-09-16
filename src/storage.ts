import { Redis } from "@upstash/redis";

// Automatically reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from process.env
const redis = Redis.fromEnv();

// Expire IDs after 30 days (in seconds)
const RETENTION_SECONDS = 60 * 60 * 24 * 30;
const KEY_PREFIX = "seen:job:";

/**
 * Filters out jobs that already exist in Redis.
 * Uses an HTTP pipeline to check all keys in a single network round-trip.
 */
export async function filterUnseenJobs<T extends { id: string }>(jobs: T[]): Promise<T[]> {
  if (jobs.length === 0) return [];

  const pipeline = redis.pipeline();
  for (const job of jobs) {
    pipeline.exists(`${KEY_PREFIX}${job.id}`);
  }

  // Returns array of 1 (exists) or 0 (does not exist)
  const results = await pipeline.exec<number[]>();

  return jobs.filter((_, idx) => results[idx] === 0);
}

/**
 * Marks a single job as seen with a rolling TTL.
 */
export async function markJobAsSeen(id: string): Promise<void> {
  await redis.set(`${KEY_PREFIX}${id}`, "1", { ex: RETENTION_SECONDS });
}

/**
 * Batch marks multiple jobs as seen in a single HTTP request.
 */
export async function markJobsAsSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const pipeline = redis.pipeline();
  for (const id of ids) {
    pipeline.set(`${KEY_PREFIX}${id}`, "1", { ex: RETENTION_SECONDS });
  }

  await pipeline.exec();
}
