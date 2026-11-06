import { Decoder, Stream } from "@garmin/fitsdk";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { gunzipSync } from "fflate";
import type { Store, TimeAtBpm } from "./store";

// Bump when parsing or derivation changes: generate then re-derives every older row from its stored file.
export const DERIVE_VERSION = 1;

const MAX_SAMPLE_S = 10;
const EARTH_RADIUS_M = 6371000;

const xml = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

type Sample = { timeS: number; bpm: number | null; distanceM: number | null };

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

const seconds = (time: string | Date) => new Date(time).getTime() / 1000;

function parseXml(bytes: Uint8Array): any {
  const text = new TextDecoder().decode(bytes).trim();
  // The parser alone accepts truncated files, so a cut-off track would read as a short one.
  const valid = XMLValidator.validate(text);
  if (valid !== true) throw new Error(valid.err.msg);
  return xml.parse(text);
}

function metresBetween(a: any, b: any): number {
  const radians = (degrees: string) => (Number(degrees) * Math.PI) / 180;
  const dLat = radians(b["@_lat"]) - radians(a["@_lat"]);
  const dLon = radians(b["@_lon"]) - radians(a["@_lon"]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a["@_lat"])) * Math.cos(radians(b["@_lat"])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function readGpx(bytes: Uint8Array): Sample[] {
  const root = parseXml(bytes).gpx;
  if (root === undefined) throw new Error("not a GPX file");
  const points = asArray<any>(root.trk)
    .flatMap((track) => asArray<any>(track.trkseg))
    .flatMap((segment) => asArray<any>(segment.trkpt));
  let distanceM = 0;
  return points.map((p, i) => {
    if (i > 0) distanceM += metresBetween(points[i - 1], p);
    return { timeS: seconds(p.time), bpm: p.extensions?.TrackPointExtension?.hr ?? null, distanceM };
  });
}

function readFit(bytes: Uint8Array): Sample[] {
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  if (!decoder.checkIntegrity()) throw new Error("not a FIT file, or a damaged one");
  const { messages, errors } = decoder.read();
  if (errors.length) throw errors[0];
  return (messages.recordMesgs ?? []).map((r) => ({
    timeS: seconds(r.timestamp as Date),
    bpm: (r.heartRate as number | undefined) ?? null,
    distanceM: (r.distance as number | undefined) ?? null,
  }));
}

function readTcx(bytes: Uint8Array): Sample[] {
  const root = parseXml(bytes).TrainingCenterDatabase;
  if (root === undefined) throw new Error("not a TCX file");
  return asArray<any>(root.Activities?.Activity)
    .flatMap((activity) => asArray<any>(activity.Lap))
    .flatMap((lap) => asArray<any>(lap.Track))
    .flatMap((track) => asArray<any>(track.Trackpoint))
    .map((p) => ({
      timeS: seconds(p.Time),
      bpm: p.HeartRateBpm?.Value ?? null,
      distanceM: p.DistanceMeters ?? null,
    }));
}

function readSamples(format: string, gz: Uint8Array): Sample[] {
  const bytes = gunzipSync(gz);
  if (format === "fit") return readFit(bytes);
  return format === "tcx" ? readTcx(bytes) : readGpx(bytes);
}

function timeAtBpm(samples: Sample[]): TimeAtBpm | null {
  const withHr = samples.filter((s) => s.bpm);
  const time: TimeAtBpm = {};
  for (const [i, sample] of withHr.entries()) {
    const next = withHr[i + 1];
    if (next && next.timeS > sample.timeS) {
      time[sample.bpm!] = (time[sample.bpm!] ?? 0) + Math.min(next.timeS - sample.timeS, MAX_SAMPLE_S);
    }
  }
  return Object.keys(time).length ? time : null;
}

export function deriveStale(store: Store, log: (line: string) => void): void {
  for (const { id, startUtc, format, gz } of store.staleFiles(DERIVE_VERSION)) {
    let samples: Sample[];
    try {
      samples = readSamples(format, gz);
    } catch (error) {
      const reason = error instanceof Error ? error.message : error;
      log(`Warning: can't read the ${format} file of the activity from ${startUtc}: ${reason}`);
      store.saveDerived(id, null, 0);
      continue;
    }
    store.saveDerived(id, timeAtBpm(samples), DERIVE_VERSION);
  }
}
