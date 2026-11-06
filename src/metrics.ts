import type { Settings } from "./settings";
import type { StoredActivity, TimeAtBpm } from "./store";

export type ActivityRow = {
  stravaId: string | null;
  date: string;
  title: string | null;
  type: string;
  distanceM: number;
  movingS: number;
  stoppedS: number;
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

type Bests = { best1k: number | null; best5k: number | null; best10k: number | null; longestRun: ActivityRow | null };

export type CurrentLevel = Bests & {
  longRuns: number;
  weeks: number;
  weeksWithLongRun: number;
  recent: ActivityRow[];
  weeklyDistanceM: number;
  weeklyDistanceChangePct: number | null;
  totalDistanceM: number;
  timeRunningS: number;
  runs: number;
  runsPerWeek: number;
  crossTrainingPerWeek: number;
};

export type TrendEffort = { seconds: number; race: boolean };

// key is the month (YYYY-MM) or the week's Monday (YYYY-MM-DD).
export type TrendBucket = {
  key: string;
  runDistanceM: number;
  longestRunM: number | null;
  best5k: TrendEffort | null;
  best10k: TrendEffort | null;
  zoneSeconds: number[] | null; // Zone 1 first
  efficiency: number | null; // metres per heartbeat
  zone2PaceSPerKm: number | null;
  avgHr: number | null;
};

export type DashboardData = {
  meta: { generatedAt: string; timeZone: string; watchEraStart: string; newestActivity: string | null; awaitingStrava: number };
  activities: ActivityRow[];
  currentLevel: Record<Period, CurrentLevel>;
  allTime: Bests & { fastest5kRace: ActivityRow | null; fastest7kRace: ActivityRow | null; fastest10kRace: ActivityRow | null };
  streaks: Record<StreakBasis, Streak>;
  trends: { month: TrendBucket[]; week: TrendBucket[] };
};

type Activity = StoredActivity & { row: ActivityRow };

// Dates are local YYYY-MM-DD strings, both ends included.
type Span = { start: string; end: string; days: number };

const DAY_MS = 86_400_000;
const LONG_RUN_M = 10_000;
const RECENT_ACTIVITIES = 8;
const WATCH_ERA_START = "2024-08-23";

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

const monthOf = (date: string) => date.slice(0, 7);
const mondayOf = (date: string) => isoDate(Date.parse(date) - ((new Date(date).getUTCDay() + 6) % 7) * DAY_MS);
// 31 days past the 1st always lands in the next month.
const nextMonth = (month: string) => monthOf(isoDate(Date.parse(`${month}-01`) + 31 * DAY_MS));
const nextWeek = (monday: string) => isoDate(Date.parse(monday) + 7 * DAY_MS);

function fastest(runs: Activity[], distanceM: number): TrendEffort | null {
  const efforts = runs.flatMap((run) => {
    const seconds = run.bestEfforts[distanceM];
    return seconds === undefined ? [] : [{ seconds, race: run.row.race }];
  });
  return efforts.reduce<TrendEffort | null>((best, effort) => (best && best.seconds <= effort.seconds ? best : effort), null);
}

// hrZones are lower bounds, so time below the first is in no zone.
function secondsInZones(timeAtBpm: TimeAtBpm, hrZones: number[]): number[] {
  const seconds = hrZones.map(() => 0);
  for (const [bpm, time] of Object.entries(timeAtBpm)) {
    const zone = hrZones.findLastIndex((lower) => Number(bpm) >= lower);
    if (zone >= 0) seconds[zone]! += time;
  }
  return seconds;
}

function timeInZones(activities: Activity[], hrZones: number[]): number[] | null {
  const perActivity = activities.flatMap((a) => (a.timeAtBpm ? [secondsInZones(a.timeAtBpm, hrZones)] : []));
  if (!perActivity.length) return null;
  return hrZones.map((_, zone) => sum(perActivity.map((seconds) => seconds[zone]!)));
}

// Time below Zone 1 is in no zone but still counts as HR-recorded time.
function mostlyZone2(timeAtBpm: TimeAtBpm, hrZones: number[]): boolean {
  return secondsInZones(timeAtBpm, hrZones)[1]! / sum(Object.values(timeAtBpm)) > 0.5;
}

const mean = (values: number[]) => (values.length ? sum(values) / values.length : null);

// Every bucket from first to end exists, even an empty one, so all charts share one axis.
function trend(
  activities: Activity[],
  hrZones: number[],
  first: string,
  end: string,
  keyOf: (date: string) => string,
  next: (key: string) => string,
): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  for (let key = keyOf(first); key <= keyOf(end); key = next(key)) {
    const inBucket = activities.filter((a) => keyOf(a.row.date) === key);
    const runs = inBucket.filter((a) => a.type === "run");
    const distances = runs.map((run) => run.distanceM);
    const hrRuns = runs.filter((run) => run.row.avgHr !== null);
    // A run with no distance or no moving time has no pace to compare.
    const paced = hrRuns.filter((run) => run.row.paceSPerKm);
    buckets.push({
      key,
      runDistanceM: distances.reduce((sum, distanceM) => sum + distanceM, 0),
      longestRunM: distances.length ? Math.max(...distances) : null,
      best5k: fastest(runs, 5000),
      best10k: fastest(runs, 10000),
      zoneSeconds: timeInZones(inBucket, hrZones),
      efficiency: mean(paced.map(({ row }) => 60_000 / row.paceSPerKm! / row.avgHr!)),
      zone2PaceSPerKm: mean(paced.filter((run) => mostlyZone2(run.timeAtBpm!, hrZones)).map((run) => run.row.paceSPerKm!)),
      avgHr: mean(hrRuns.map((run) => run.row.avgHr!)),
    });
  }
  return buckets;
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

// Ties go to the first row, which is the newest.
function lowestBy(rows: ActivityRow[], rank: (row: ActivityRow) => number): ActivityRow | null {
  return rows.reduce<ActivityRow | null>((best, row) => (!best || rank(row) < rank(best) ? row : best), null);
}

function fastestRace(activities: ActivityRow[], minM: number, maxM: number): ActivityRow | null {
  const inBand = activities.filter((a) => a.race && a.distanceM >= minM && a.distanceM <= maxM);
  return lowestBy(inBand, (a) => a.movingS / a.distanceM);
}

function bests(runs: Activity[]): Bests {
  const lowest = (distanceM: number) => {
    const times = runs.flatMap((run) => run.bestEfforts[distanceM] ?? []);
    return times.length ? Math.min(...times) : null;
  };
  return {
    best1k: lowest(1000),
    best5k: lowest(5000),
    best10k: lowest(10000),
    longestRun: lowestBy(runs.map((run) => run.row), (row) => -row.distanceM),
  };
}

function currentLevel(runs: Activity[], activities: ActivityRow[], { start, end, days }: Span): CurrentLevel {
  const inPeriod = runs.filter((run) => run.row.date >= start);
  const activitiesInPeriod = activities.filter((a) => a.date >= start);
  const longRuns = inPeriod.filter((run) => run.distanceM >= LONG_RUN_M);
  const totalDistanceM = sum(inPeriod.map((run) => run.distanceM));
  const weeks = days / 7;
  // "All" starts at the first activity, so nothing comes before it and its change is null too.
  const previousStart = isoDate(Date.parse(start) - days * DAY_MS);
  const previousM = sum(runs.filter((run) => run.row.date >= previousStart && run.row.date < start).map((run) => run.distanceM));
  return {
    ...bests(inPeriod),
    longRuns: longRuns.length,
    weeks: Math.ceil(days / 7),
    weeksWithLongRun: new Set(longRuns.map((run) => Math.floor(daysBetween(run.row.date, end) / 7))).size,
    recent: activitiesInPeriod.slice(0, RECENT_ACTIVITIES),
    weeklyDistanceM: totalDistanceM / weeks,
    weeklyDistanceChangePct: previousM ? ((totalDistanceM - previousM) / previousM) * 100 : null,
    totalDistanceM,
    timeRunningS: sum(inPeriod.map((run) => run.movingS)),
    runs: inPeriod.length,
    runsPerWeek: inPeriod.length / weeks,
    crossTrainingPerWeek: (activitiesInPeriod.length - inPeriod.length) / weeks,
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
  const activities = stored.map(({ stravaId, startUtc, type, title, tags, distanceM, elapsedS, movingS, timeAtBpm }) => ({
    stravaId,
    date: localDate.format(new Date(startUtc)),
    title,
    type,
    distanceM,
    movingS,
    stoppedS: elapsedS - movingS,
    paceSPerKm: type === "run" && distanceM ? movingS / (distanceM / 1000) : null,
    ...heartRate(timeAtBpm),
    race: type === "run" && tags.split("|").includes("race"),
    longRun: type === "run" && distanceM >= LONG_RUN_M,
    ...session(type === "run" ? (title ?? "") : ""),
  }));
  const joined = stored.map((a, i) => ({ ...a, row: activities[i]! }));
  const runs = joined.filter((a) => a.type === "run");
  // With nothing stored there is no newest activity, and every period is empty anyway.
  const end = activities[0]?.date ?? localDate.format(now);
  const first = activities.at(-1)?.date ?? end;
  const spans = Object.entries(periodSpans(end, first));
  return {
    meta: {
      generatedAt: now.toISOString(),
      timeZone: settings.timeZone,
      watchEraStart: WATCH_ERA_START,
      newestActivity: activities[0]?.date ?? null,
      awaitingStrava: stored.filter((a) => a.source === "polar").length,
    },
    activities,
    currentLevel: Object.fromEntries(spans.map(([period, span]) => [period, currentLevel(runs, activities, span)])) as Record<Period, CurrentLevel>,
    allTime: {
      ...bests(runs),
      fastest5kRace: fastestRace(activities, 4900, 5600),
      fastest7kRace: fastestRace(activities, 6400, 7700),
      fastest10kRace: fastestRace(activities, 9900, 10500),
    },
    streaks: {
      runs: streak(runs.map((run) => run.row.date), end),
      all: streak(activities.map((a) => a.date), end),
    },
    trends: {
      month: trend(joined, settings.hrZones, first, end, monthOf, nextMonth),
      week: trend(joined, settings.hrZones, first, end, mondayOf, nextWeek),
    },
  };
}
