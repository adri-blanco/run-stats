import type { Settings } from "./settings";
import type { StoredActivity } from "./store";

export type ActivityRow = { date: string; title: string; type: string; distanceM: number; movingS: number };

export type DashboardData = {
  meta: { generatedAt: string; timeZone: string; newestActivity: string | null };
  activities: ActivityRow[];
};

export function buildDashboardData(stored: StoredActivity[], settings: Settings, now: Date): DashboardData {
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const activities = stored.map(({ startUtc, type, title, distanceM, movingS }) => ({
    date: localDate.format(new Date(startUtc)),
    title,
    type,
    distanceM,
    movingS,
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
