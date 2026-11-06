import { readFileSync } from "node:fs";
import { errorMessage } from "./errors";

const BARRIER_DISTANCES = ["5K", "10K", "1K"] as const;

export type Settings = {
  timeZone: string;
  hrZones: number[];
  firstBarrierSeconds: Record<(typeof BARRIER_DISTANCES)[number], number[]>;
};

const isPositive = (value: unknown) => typeof value === "number" && value > 0;
const isBarrierList = (value: unknown) => Array.isArray(value) && value.length > 0 && value.every(isPositive);

function isTimeZone(value: unknown): boolean {
  try {
    return typeof value === "string" && !!new Intl.DateTimeFormat("en", { timeZone: value });
  } catch {
    return false;
  }
}

function check(valid: boolean, message: string): void {
  if (!valid) throw new Error(`Bad settings: ${message}`);
}

export function loadSettings(path: string): Settings {
  let settings: Partial<Settings>;
  try {
    settings = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Bad settings: can't read ${path}: ${errorMessage(error)}`);
  }
  const { timeZone, hrZones, firstBarrierSeconds } = settings;
  check(isTimeZone(timeZone), `timeZone ${JSON.stringify(timeZone)} is not a time zone`);
  check(
    Array.isArray(hrZones) &&
      hrZones.length === 5 &&
      hrZones.every((bpm, i) => isPositive(bpm) && (i === 0 || bpm > hrZones[i - 1]!)),
    `hrZones must be five rising bpm values, got ${JSON.stringify(hrZones)}`,
  );
  check(
    typeof firstBarrierSeconds === "object" &&
      firstBarrierSeconds !== null &&
      Object.values(firstBarrierSeconds).every(isBarrierList) &&
      BARRIER_DISTANCES.every((distance) => isBarrierList(firstBarrierSeconds[distance])),
    `firstBarrierSeconds must list positive seconds for ${BARRIER_DISTANCES.join(", ")}, got ${JSON.stringify(firstBarrierSeconds)}`,
  );
  return settings as Settings;
}
