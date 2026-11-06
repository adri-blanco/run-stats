import type { Settings } from "./settings";
import type { StoredActivity, TimeAtBpm } from "./store";

export type ActivityRow = {
  stravaId: string | null;
  date: string;
  title: string;
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
};

export type Achievement = {
  kind: "record" | "race" | "first" | "streak";
  date: string;
  label: string;
  value: number | null;
  previous: number | null;
  unit: "time" | "distance" | "weeks" | null;
  activity: ActivityRow | null;
  streakBasis?: StreakBasis;
};

export type DashboardData = {
  meta: { generatedAt: string; timeZone: string; newestActivity: string | null };
  activities: ActivityRow[];
  currentLevel: Record<Period, CurrentLevel>;
  allTime: Bests & { fastest5kRace: ActivityRow | null; fastest7kRace: ActivityRow | null; fastest10kRace: ActivityRow | null };
  streaks: Record<StreakBasis, Streak>;
  trends: { month: TrendBucket[]; week: TrendBucket[] };
  achievements: Achievement[];
};

type Run = StoredActivity & { row: ActivityRow };

// Dates are local YYYY-MM-DD strings, both ends included.
type Span = { start: string; end: string; days: number };

const DAY_MS = 86_400_000;
const LONG_RUN_M = 10_000;
const RECENT_ACTIVITIES = 8;
const FIRST_WHOLE_KM = 11;
const BEST_EFFORTS = [["1K", 1000], ["5K", 5000], ["10K", 10000]] as const;

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

function fastest(runs: Run[], distanceM: number): TrendEffort | null {
  const efforts = runs.flatMap((run) => {
    const seconds = run.bestEfforts[distanceM];
    return seconds === undefined ? [] : [{ seconds, race: run.row.race }];
  });
  return efforts.reduce<TrendEffort | null>((best, effort) => (best && best.seconds <= effort.seconds ? best : effort), null);
}

// Every bucket from first to end exists, even an empty one, so all charts share one axis.
function trend(
  runs: Run[],
  first: string,
  end: string,
  keyOf: (date: string) => string,
  next: (key: string) => string,
): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  for (let key = keyOf(first); key <= keyOf(end); key = next(key)) {
    const inBucket = runs.filter((run) => keyOf(run.row.date) === key);
    const distances = inBucket.map((run) => run.distanceM);
    buckets.push({
      key,
      runDistanceM: distances.reduce((sum, distanceM) => sum + distanceM, 0),
      longestRunM: distances.length ? Math.max(...distances) : null,
      best5k: fastest(inBucket, 5000),
      best10k: fastest(inBucket, 10000),
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

function bests(runs: Run[]): Bests {
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

function currentLevel(runs: Run[], activities: ActivityRow[], { start, end, days }: Span): CurrentLevel {
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

// One row per streak, at its full length, not one per week.
function streakRecords(dates: string[], streakBasis: StreakBasis): Achievement[] {
  const mondays = [...new Set(dates.map(mondayOf))].sort();
  const found: Achievement[] = [];
  let length = 0;
  let longest = 0;
  mondays.forEach((monday, i) => {
    length = mondays[i - 1] && nextWeek(mondays[i - 1]!) === monday ? length + 1 : 1;
    if (mondays[i + 1] === nextWeek(monday) || length <= longest) return;
    if (longest) found.push({ kind: "streak", date: monday, label: "Longest streak", value: length, previous: longest, unit: "weeks", activity: null, streakBasis });
    longest = length;
  });
  return found;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function achievements(runs: Run[], activities: ActivityRow[], trends: DashboardData["trends"], barriers: Settings["firstBarrierSeconds"]): Achievement[] {
  const found: Achievement[] = [];
  const best: Record<string, number> = {};
  const seen = new Set<string>();
  const first = (label: string, unit: Achievement["unit"], value: number, activity: ActivityRow) => {
    if (seen.has(label)) return;
    seen.add(label);
    found.push({ kind: "first", date: activity.date, label, value, previous: null, unit, activity });
  };
  const record = (label: string, unit: Achievement["unit"], value: number, date: string, activity: ActivityRow | null) => {
    const previous = best[label];
    if (previous !== undefined && (unit === "time" ? value >= previous : value <= previous)) return;
    best[label] = value;
    // A previous 0 is an empty first week or month, so there was nothing to beat.
    if (previous) found.push({ kind: "record", date, label, value, previous, unit, activity });
  };
  for (const { distanceM, bestEfforts, row } of runs.toReversed()) {
    first("First run", "distance", distanceM, row);
    if (row.race) {
      first("First race", "distance", distanceM, row);
      found.push({ kind: "race", date: row.date, label: row.title, value: null, previous: null, unit: null, activity: row });
    }
    if (row.longRun) first("First long run", "distance", distanceM, row);
    for (let km = FIRST_WHOLE_KM; km <= distanceM / 1000; km++) first(`First ${km} km`, "distance", distanceM, row);
    for (const [name, distance] of BEST_EFFORTS) {
      const seconds = bestEfforts[distance];
      if (seconds === undefined) continue;
      record(`Best ${name}`, "time", seconds, row.date, row);
      for (const barrier of barriers[name] ?? []) {
        if (seconds < barrier) first(`${name} under ${clock(barrier)}`, "time", seconds, row);
      }
    }
    record("Longest run", "distance", distanceM, row.date, row);
  }
  for (const { key, runDistanceM } of trends.week) record("Record week", "distance", runDistanceM, key, null);
  // Every month has a 28th, so a month's record sorts after what happened in it.
  for (const { key, runDistanceM } of trends.month) record("Record month", "distance", runDistanceM, `${key}-28`, null);
  found.push(...streakRecords(runs.map((run) => run.row.date), "runs"), ...streakRecords(activities.map((a) => a.date), "all"));
  return found.toSorted((a, b) => b.date.localeCompare(a.date));
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
    ...session(type === "run" ? title : ""),
  }));
  const runs = stored.map((a, i) => ({ ...a, row: activities[i]! })).filter((a) => a.type === "run");
  // With nothing stored there is no newest activity, and every period is empty anyway.
  const end = activities[0]?.date ?? localDate.format(now);
  const first = activities.at(-1)?.date ?? end;
  const spans = Object.entries(periodSpans(end, first));
  const trends = { month: trend(runs, first, end, monthOf, nextMonth), week: trend(runs, first, end, mondayOf, nextWeek) };
  return {
    meta: {
      generatedAt: now.toISOString(),
      timeZone: settings.timeZone,
      newestActivity: activities[0]?.date ?? null,
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
    trends,
    achievements: achievements(runs, activities, trends, settings.firstBarrierSeconds),
  };
}
