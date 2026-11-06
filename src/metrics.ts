import type { Settings } from "./settings";
import type { StoredActivity, TimeAtBpm } from "./store";

export type ActivityRow = {
  stravaId: string | null;
  date: string;
  title: string;
  type: string;
  distanceM: number;
  movingS: number;
  paceSPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  race: boolean;
  longRun: boolean;
  sessionType: string | null;
  sessionDetail: string | null;
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

const SESSION_TYPES: [string, RegExp][] = [
  ["Intervals", /^\d+x\d+(k?m)?$/i],
  ["Fartlek", /^(fartlek|\d+x\(?\d+(-\d+)+\)?$)/i],
  ["Hills", /^(hillsx\d+|\d+xhills)$/i],
  ["Zone 2", /^~?zon[ea] 2$/i],
  ["HIIT", /^hiit$/i],
  ["Running test", /^(running test|rt)$/i],
  ["Long run", /^long run$/i],
];

function session(title: string): Pick<ActivityRow, "sessionType" | "sessionDetail"> {
  const label = title.match(/^\[(.*?)\]/)?.[1] ?? "";
  const sessionType = SESSION_TYPES.find(([, pattern]) => pattern.test(label))?.[0] ?? null;
  return { sessionType, sessionDetail: sessionType && label };
}

export function buildDashboardData(stored: StoredActivity[], settings: Settings, now: Date): DashboardData {
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const activities = stored.map(({ stravaId, startUtc, type, title, tags, distanceM, movingS, timeAtBpm }) => ({
    stravaId,
    date: localDate.format(new Date(startUtc)),
    title,
    type,
    distanceM,
    movingS,
    paceSPerKm: type === "run" && distanceM ? movingS / (distanceM / 1000) : null,
    ...heartRate(timeAtBpm),
    race: type === "run" && tags.split("|").includes("race"),
    longRun: type === "run" && distanceM >= 10_000,
    ...session(type === "run" ? title : ""),
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
