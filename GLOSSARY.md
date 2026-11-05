# Glossary

**Activity**: one session recorded on Strava, of any type (run, ride, walk, gym…). Every activity is imported and classified, not only runs.

**Run**: an activity whose type is a running type (road, trail, treadmill…). Most metrics are computed on runs.

**Bulk export**: the zip of the athlete's whole Strava history that Strava emails on request. It's the only data source.

**Import**: loading a bulk export into the local store.

**Refresh**: importing a newer bulk export and adding only the activities that aren't already stored.

**Dashboard**: the static HTML page shown to the trainer. It answers three questions, in order: current level, trajectory over time, biggest achievements.

**Half-marathon readiness**: the dashboard's purpose. It gives the trainer evidence for judging whether a half marathon (21.1 km) is a suitable next goal. The dashboard shows only evidence: it never gives a verdict or a predicted time.

**Activity type**: Strava's own classification of an activity (Run, TrailRun, Ride, WeightTraining…).

**Race**: a run in an official organised event (popular runs around the city). Only runs the athlete tagged as a race on Strava count; titles never make a run a race. A race is still a run, marked as a race.

**Long run**: a run of 10 km or more, races included. A mark on the run, not a separate kind of run; the athlete's own "Long Run" label doesn't make a shorter run long.

**Session type**: what kind of training a run was, taken from the athlete's bracketed label at the start of the run's title: intervals, fartlek, hills, zone 2, HIIT, running test or long run. The label's own text (e.g. "6x1km") is kept as the session's detail. Brackets naming people, groups or race distances give no session type. Most runs have none.

**Phone era / watch era**: before 2024-08-23 runs were recorded with the phone (no heart rate); since then they've been recorded with a heart-rate watch. Metrics that need heart rate only cover the watch era.
