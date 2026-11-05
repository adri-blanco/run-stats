# Glossary

**Activity**: one training session of any type (run, hike, gym…), known from a bulk export or a refresh. Every activity is stored and classified, not only runs.

**Run**: an activity whose activity type is run (road, trail and treadmill alike). Most metrics are computed on runs.

**Bulk export**: the zip of the athlete's whole Strava history that Strava emails on request. It's the source of the athlete's history.

**Import**: loading a bulk export into the local store, including any later full export.

**Refresh**: pulling new exercises from Polar AccessLink and adding only those not already stored.

**Provisional activity**: an activity known only from a refresh. It has no title, so no session type and no race mark, until a bulk export adopts it and replaces its details with Strava's.

**Dashboard**: the static HTML page shown to the trainer. It answers three questions, in order: current level, trajectory over time, biggest achievements.

**Half-marathon readiness**: the dashboard's purpose. It gives the trainer evidence for judging whether a half marathon (21.1 km) is a suitable next goal. The dashboard shows only evidence: it never gives a verdict or a predicted time.

**Activity type**: the tool's own short classification of an activity (run, hike, strength, workout, swim, kayak, football, other), mapped from what Strava or Polar reports.

**Race**: a run in an official organised event (popular runs around the city). Only runs the athlete tagged as a race on Strava count; titles never make a run a race. A race is still a run, marked as a race.

**Race distance**: the band a race is compared in: a 5K race is 4.9 to 5.6 km, a 7K race 6.4 to 7.7 km, a 10K race 9.9 to 10.5 km. Races outside these bands count as races but aren't compared.

**Long run**: a run of 10 km or more, races included. A mark on the run, not a separate kind of run; the athlete's own "Long Run" label doesn't make a shorter run long.

**Session type**: what kind of training a run was, taken from the athlete's bracketed label at the start of the run's title: intervals, fartlek, hills, zone 2, HIIT, running test or long run. The label's own text (e.g. "6x1km") is kept as the session's detail. Brackets naming people, groups or race distances give no session type. Most runs have none.

**Phone era / watch era**: before 2024-08-23 runs were recorded with the phone (no heart rate); since then they've been recorded with a heart-rate watch. Metrics that need heart rate only cover the watch era.

**Best effort**: the fastest continuous stretch of a set distance (1K, 5K, 10K) inside any run, races and training alike, timed including any stops within the stretch. Strava's own best efforts aren't available, so these are always computed.

**Achievement**: a highlighted moment on the dashboard: a new all-time best effort, longest run, record week or month of run distance, or longest streak; a race completed; or a first (first run, race or long run, a new longest whole-km distance, a best effort under a set barrier).

**Streak**: consecutive calendar weeks, Monday to Sunday, with at least one activity, counting either runs only or activities of any type.

**View control**: a control on the dashboard page that anyone viewing can change, such as the period selector or the weekly/monthly switch.

**Settings**: values the athlete sets, such as heart-rate zones and first barriers, that are fixed into the dashboard when it's generated.
