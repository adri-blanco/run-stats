import { readFileSync } from "node:fs";

export type Settings = {
  timeZone: string;
  hrZones: number[];
  firstBarrierSeconds: Record<string, number[]>;
};

const isPositive = (value: unknown) => typeof value === "number" && value > 0;

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
    throw new Error(`Bad settings: can't read ${path}: ${error instanceof Error ? error.message : error}`);
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
      Object.values(firstBarrierSeconds).every((b) => Array.isArray(b) && b.length > 0 && b.every(isPositive)),
    `firstBarrierSeconds must list positive seconds per distance, got ${JSON.stringify(firstBarrierSeconds)}`,
  );
  return settings as Settings;
}
