import { parse } from "csv-parse/sync";
import { gzipSync, unzipSync, type Unzipped } from "fflate";
import { readFileSync } from "node:fs";
import type { NewActivity } from "./store";

const COLUMN = { id: 0, start: 1, title: 2, type: 3, file: 12, elapsed: 15, moving: 16, distance: 17, tags: 103 };
const SPANISH_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
const ACTIVITY_TYPES: Record<string, string> = {
  Carrera: "run",
  "Entrenamiento con pesas": "strength",
  Entrenamiento: "workout",
  Senderismo: "hike",
  Natación: "swim",
  Kayak: "kayak",
  Fútbol: "football",
};

function startUtc(cell: string): string {
  const m = cell.match(/^(\d+) (\p{L}+)\.?,? (\d{4}), (\d+):(\d+):(\d+)$/u);
  const month = SPANISH_MONTHS.indexOf(m?.[2] ?? "");
  if (!m || month < 0) throw new Error(`Unreadable date in activities.csv: "${cell}"`);
  return new Date(Date.UTC(+m[3]!, month, +m[1]!, +m[4]!, +m[5]!, +m[6]!)).toISOString();
}

// Number("") is 0, which is what the spec wants for an empty cell.
function number(cell: string): number {
  const value = Number(cell.includes(",") ? cell.replaceAll(".", "").replace(",", ".") : cell);
  if (Number.isNaN(value)) throw new Error(`Unreadable number in activities.csv: "${cell}"`);
  return value;
}

function originalFile(zip: Unzipped, name: string, log: (line: string) => void): NewActivity["file"] {
  if (!name) return null;
  const bytes = zip[name];
  const format = name.match(/\.(gpx|tcx|fit)(\.gz)?$/);
  if (!bytes || !format) {
    log(`Warning: skipped activity file ${name}, not found in the zip or not a known format`);
    return null;
  }
  return { format: format[1]!, gz: format[2] ? bytes : gzipSync(bytes) };
}

function readZip(zipPath: string): Unzipped {
  try {
    return unzipSync(readFileSync(zipPath));
  } catch (error) {
    throw new Error(`Unreadable zip ${zipPath}: ${error instanceof Error ? error.message : error}`);
  }
}

export function readBulkExport(zipPath: string, log: (line: string) => void): NewActivity[] {
  const zip = readZip(zipPath);
  const csv = zip["activities.csv"];
  if (!csv) throw new Error("No activities.csv in the zip");
  // Read by index: the header row repeats names, so it carries no information.
  const rows: string[][] = parse(Buffer.from(csv), { bom: true, from_line: 2 });
  return rows.map((row) => {
    const stravaType = row[COLUMN.type]!;
    const type = ACTIVITY_TYPES[stravaType];
    if (!type) log(`Unknown Activity type "${stravaType}" on activity ${row[COLUMN.id]}, stored as other`);
    return {
      stravaId: row[COLUMN.id]!,
      source: "strava",
      startUtc: startUtc(row[COLUMN.start]!),
      type: type ?? "other",
      title: row[COLUMN.title]!,
      tags: row[COLUMN.tags]!,
      elapsedS: number(row[COLUMN.elapsed]!),
      movingS: number(row[COLUMN.moving]!),
      distanceM: number(row[COLUMN.distance]!),
      file: originalFile(zip, row[COLUMN.file]!, log),
    };
  });
}
