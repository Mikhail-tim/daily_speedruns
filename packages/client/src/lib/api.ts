import { Challenge, LeaderboardEntry, RunSubmission } from "@daily-speedruns/shared";

export interface ChallengeResponse extends Challenge {
  name: string;
  description: string;
  targetDescription: string;
}

export interface LeaderboardResponse {
  date: string;
  gameId?: string;
  leaderboard: LeaderboardEntry[];
  userBestTimeMs: number | null;
}

export interface SubmissionResponse {
  verified: boolean;
  runId?: string;
  verifiedTimeMs?: number;
  rank?: number | null;
  error?: string;
  reason?: string;
}

export async function fetchTodayChallenge(
  date?: string,
  gameId?: string
): Promise<ChallengeResponse> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (gameId) params.set("game", gameId);

  const qs = params.toString();
  const url = qs ? `/api/challenge/today?${qs}` : "/api/challenge/today";

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch challenge: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchLeaderboard(
  date?: string,
  userId?: string,
  gameId?: string
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (userId) params.set("userId", userId);
  if (gameId) params.set("game", gameId);

  const res = await fetch(`/api/leaderboard?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch leaderboard: ${res.statusText}`);
  }
  return res.json();
}

export async function submitRun(run: RunSubmission): Promise<SubmissionResponse> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(run),
  });

  const data = await res.json();
  if (!res.ok) {
    return {
      verified: false,
      error: data.error || "Submission failed",
      reason: data.reason,
    };
  }
  return data;
}

export async function updateNicknameOnServer(
  userId: string,
  nickname: string
): Promise<void> {
  await fetch("/api/user/nickname", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, nickname }),
  });
}
