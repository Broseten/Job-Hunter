import * as fs from "fs";
import * as path from "path";

const SEEN_FILE = path.resolve(process.cwd(), "seen_ids.json");

function readSeenIds(): Set<string> {
  if (!fs.existsSync(SEEN_FILE)) return new Set();
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8"));
    return new Set(Array.isArray(data) ? data : []);
  } catch {
    return new Set();
  }
}

// Filters incoming jobs against saved IDs without modifying the file
export function filterUnseenJobs<T extends { id: string }>(jobs: T[]): T[] {
  const seenSet = readSeenIds();
  return jobs.filter((j) => !seenSet.has(j.id));
}

// Call this ONLY when a job is successfully processed
export function markJobAsSeen(id: string): void {
  const seenSet = readSeenIds();
  seenSet.add(id);

  // Keep the last 1000 IDs to keep the file lightweight
  const trimmed = Array.from(seenSet).slice(-1000);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(trimmed, null, 2));
}
