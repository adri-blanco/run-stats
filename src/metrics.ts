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

export type Period = "3w" | "8w" | "3m" | "1y" | "all";
export type StreakBasis = "runs" | "all";
type Streak = { current: number; longest: number };

type Bests = { best1k: number | null; best5k: number | null; best10k: number | null; longestRunM: number | null };

export type CurrentLevel = Bests & {
  longRuns: number;
  weeks: number;
  weeksWithLongRun: number;
  weeklyDistanceM: number;
  weeklyDistanceChangePct: number | null;
  totalDistanceM: number;
  timeRunningS: number;
  runs: number;
  runsPerWeek: number;
  crossTrainingPerWeek: number;
};

export type DashboardData = {
  meta: { generatedAt: string; timeZone: string; newestActivity: string | null };
  activities: ActivityRow[];
  currentLevel: Record<Period, CurrentLevel>;
  allTime: Bests;
  streaks: Record<StreakBasis, Streak>;
};

// Dates are local YYYY-MM-DD strings, both ends included.
type Span = { start: string; end: string; days: number };

const DAY_MS = 86_400_000;
const LONG_RUN_M = 10_000;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY_MS;

// The day after the same date n months earlier, or after that month's last day if it is shorter.
function monthsBackStart(end: string, months: number): string {
  const [year, month, day] = end.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(year, month - months, 0)).getUTCDate();
  return isoDate(Date.UTC(year, month - 1 - months, Math.min(day, lastDay) + 1));
}

function periodSpans(end: string, first: string): Record<Period, Span> {
  const weeksBackStart = (weeks: number) => isoDate(Date.parse(end) - (weeks * 7 - 1) * DAY_MS);
  const span = (start: string): Span => ({ start, end, days: daysBetween(start, end) + 1 });
  return {
    "3w": span(weeksBackStart(3)),
    "8w": span(weeksBackStart(8)),
    "3m": span(monthsBackStart(end, 3)),
    "1y": span(monthsBackStart(end, 12)),
    all: span(first),
  };
}

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

type Dated = StoredActivity & { date: string };

function bests(runs: StoredActivity[]): Bests {
  const lowest = (distanceM: number) => {
    const times = runs.flatMap((run) => run.bestEfforts[distanceM] ?? []);
    return times.length ? Math.min(...times) : null;
  };
  return {
    best1k: lowest(1000),
    best5k: lowest(5000),
    best10k: lowest(10000),
    longestRunM: runs.length ? Math.max(...runs.map((run) => run.distanceM)) : null,
  };
}

function currentLevel(activities: Dated[], { start, end, days }: Span): CurrentLevel {
  const inPeriod = activities.filter((a) => a.date >= start);
  const runs = inPeriod.filter((a) => a.type === "run");
  const longRuns = runs.filter((run) => run.distanceM >= LONG_RUN_M);
  const totalDistanceM = sum(runs.map((run) => run.distanceM));
  const weeks = days / 7;
  // "All" starts at the first activity, so nothing comes before it and its change is null too.
  const previousStart = isoDate(Date.parse(start) - days * DAY_MS);
  const previousM = sum(
    activities.filter((a) => a.type === "run" && a.date >= previousStart && a.date < start).map((run) => run.distanceM),
  );
  return {
    ...bests(runs),
    longRuns: longRuns.length,
    weeks: Math.ceil(days / 7),
    weeksWithLongRun: new Set(longRuns.map((run) => Math.floor(daysBetween(run.date, end) / 7))).size,
    weeklyDistanceM: totalDistanceM / weeks,
    weeklyDistanceChangePct: previousM ? ((totalDistanceM - previousM) / previousM) * 100 : null,
    totalDistanceM,
    timeRunningS: sum(runs.map((run) => run.movingS)),
    runs: runs.length,
    runsPerWeek: runs.length / weeks,
    crossTrainingPerWeek: (inPeriod.length - runs.length) / weeks,
  };
}

// Monday-to-Sunday week number. 1 January 1970 was a Thursday, so 3 days back is a Monday.
const weekOf = (date: string) => Math.floor((Date.parse(date) / DAY_MS + 3) / 7);

function streak(dates: string[], end: string): Streak {
  const weeks = new Set(dates.map(weekOf));
  const endingAt = (week: number) => {
    let length = 0;
    while (weeks.has(week - length)) length++;
    return length;
  };
  return { current: endingAt(weekOf(end)), longest: Math.max(0, ...[...weeks].map(endingAt)) };
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
    longRun: type === "run" && distanceM >= LONG_RUN_M,
    ...session(type === "run" ? title : ""),
  }));
  const dated = stored.map((a) => ({ ...a, date: localDate.format(new Date(a.startUtc)) }));
  const runs = dated.filter((a) => a.type === "run");
  // With nothing stored there is no newest activity, and every period is empty anyway.
  const end = activities[0]?.date ?? localDate.format(now);
  const spans = Object.entries(periodSpans(end, activities.at(-1)?.date ?? end));
  return {
    meta: {
      generatedAt: now.toISOString(),
      timeZone: settings.timeZone,
      newestActivity: activities[0]?.date ?? null,
    },
    activities,
    currentLevel: Object.fromEntries(spans.map(([period, span]) => [period, currentLevel(dated, span)])) as Record<Period, CurrentLevel>,
    allTime: bests(runs),
    streaks: {
      runs: streak(runs.map((run) => run.date), end),
      all: streak(dated.map((a) => a.date), end),
    },
  };
}
