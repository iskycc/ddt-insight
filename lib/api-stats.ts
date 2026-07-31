import { db } from "@/lib/db";
import type { ApiCallStatistics } from "@/lib/types";

export type ApiCallCategory = "open" | "authenticated" | "anonymous";

const incrementCounter = db.prepare(`
  INSERT INTO api_call_counters (
    day, category, user_id, call_count, last_called_at
  ) VALUES (?, ?, ?, 1, ?)
  ON CONFLICT(day, category, user_id) DO UPDATE SET
    call_count = api_call_counters.call_count + 1,
    last_called_at = excluded.last_called_at
`);

const incrementApiCall = db.transaction(
  (
    day: string,
    category: ApiCallCategory,
    userId: string,
    calledAt: string,
  ) => {
    incrementCounter.run(day, category, "", calledAt);
    if (category === "authenticated" && userId) {
      incrementCounter.run(day, category, userId, calledAt);
    }
  },
);

function localDay(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function recordApiCall(
  category: ApiCallCategory,
  userId = "",
) {
  const now = new Date();
  try {
    incrementApiCall(localDay(now), category, userId, now.toISOString());
  } catch {
    // Usage metrics must never make an otherwise healthy API unavailable.
  }
}

interface PlatformAggregate {
  platformTotal: number;
  platformToday: number;
  openTotal: number;
  authenticatedTotal: number;
  anonymousTotal: number;
  lastCalledAt: string | null;
}

interface UserAggregate {
  currentUserTotal: number;
  currentUserToday: number;
}

export function getApiCallStatistics(userId: string): ApiCallStatistics {
  const today = localDay(new Date());
  const platform = db
    .prepare(`
      SELECT
        COALESCE(SUM(call_count), 0) AS platformTotal,
        COALESCE(SUM(CASE WHEN day = ? THEN call_count ELSE 0 END), 0)
          AS platformToday,
        COALESCE(SUM(CASE WHEN category = 'open' THEN call_count ELSE 0 END), 0)
          AS openTotal,
        COALESCE(SUM(
          CASE WHEN category = 'authenticated' THEN call_count ELSE 0 END
        ), 0) AS authenticatedTotal,
        COALESCE(SUM(
          CASE WHEN category = 'anonymous' THEN call_count ELSE 0 END
        ), 0) AS anonymousTotal,
        MAX(last_called_at) AS lastCalledAt
      FROM api_call_counters
      WHERE user_id = ''
    `)
    .get(today) as PlatformAggregate;
  const currentUser = db
    .prepare(`
      SELECT
        COALESCE(SUM(call_count), 0) AS currentUserTotal,
        COALESCE(SUM(CASE WHEN day = ? THEN call_count ELSE 0 END), 0)
          AS currentUserToday
      FROM api_call_counters
      WHERE user_id = ?
    `)
    .get(today, userId) as UserAggregate;

  return {
    ...platform,
    ...currentUser,
  };
}
