export interface RawJob {
  id: string;
  title: string;
  company: string;
  url: string;
  description: string;
}

export interface MatchEvaluation {
  matchScore: number; // 0 - 100
  verdict: "Strong Match" | "Moderate Match" | "Skip";
  keyMatches: string[];
  potentialGaps: string[];
  summary: string;
}
