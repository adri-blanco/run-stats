import type { Settings } from "./settings";
import type { StoredActivity, TimeAtBpm } from "./store";

export type ActivityRow = {
  date: string;
  title: string;
  type: string;
  distanceM: number;
  movingS: number;
  avgHr: number | null;
  maxHr: number | null;
};

export type DashboardData = {
  meta: { generatedAt: string; timeZone: string; newestActivity: string | null };
  activities: ActivityRow[];
};

function heartRate(timeAtBpm: TimeAtBpm | null): Pick<ActivityRow, "avgHr" | "maxHr"> {
  if (!timeAtBpm) return { avgHr: null, maxHr: null };
  const entries = Object.entries(timeAtBpm).map(([bpm, seconds]) => [Number(bpm), seconds] as const);
  const beats = entries.reduce((sum, [bpm, seconds]) => sum + bpm * seconds, 0);
  const total = entries.reduce((sum, [, seconds]) => sum + seconds, 0);
  return { avgHr: beats / total, maxHr: Math.max(...entries.map(([bpm]) => bpm)) };
}

export function buildDashboardData(stored: StoredActivity[], settings: Settings, now: Date): DashboardData {
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const activities = stored.map(({ startUtc, type, title, distanceM, movingS, timeAtBpm }) => ({
    date: localDate.format(new Date(startUtc)),
    title,
    type,
    distanceM,
    movingS,
    ...heartRate(timeAtBpm),
  }));
  return {
    meta: {
      generatedAt: now.toISOString(),
      timeZone: settings.timeZone,
      newestActivity: activities[0]?.date ?? null,
    },
    activities,
  };
}
