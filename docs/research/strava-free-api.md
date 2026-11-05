# What the Strava API gives a personal app (free account)

Research for issue #2. Sources checked on 2026-11-05. Everything below comes from
Strava's own pages: developer docs, the API changelog, the API Agreement and API
Policy (both effective June 1, 2026), and Strava staff posts on the Community Hub.

## TL;DR: findings that change the plan

1. **A free account can no longer create an API app.** Since June 1, 2026, new
   Standard Tier developers need a paid Strava subscription. Existing developers
   needed one from June 30, 2026.
   - getting-started: "A Strava subscription is a prerequisite for creating an app."
     <https://developers.strava.com/docs/getting-started/>
   - API Policy §3.3: Standard Tier apps "are subject to subscription requirements…
     including a requirement that the developer or specified end users maintain an
     active Strava subscription." <https://www.strava.com/legal/api_policy>
   - Strava staff announcement "An Update To Our Developer Program" (Jun 1, 2026):
     <https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428>
   - Strava API FAQ (staff, updated Jun 4, 2026): no extra fee for developers who
     already subscribe. <https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906>
2. **The 2026 API Policy forbids a permanent local archive of Strava data.**
   - §6.2: "You may not retain Strava Data in your cache for longer than seven (7) days."
   - §5.5: no bulk export "by accumulating Strava Data through repeated authorized API
     calls into a corpus, dataset, archive, or database that exceeds the operational
     scope of your Developer Application". No storage in any "Persistent Index".
   - §6.3: deletions made on Strava must show up in the app within 48 hours.
   - A SQLite database that imports everything once and then only fetches new
     activities is the pattern these clauses describe. Read literally, it is not
     allowed even for a single-user app.
3. **AI clause (§5.3).** Strava Data and anything derived from it may not be used to
   operate an "AI Application". The list includes "ingestion into a context window or
   working memory". The only exception is Strava's own MCP connector, which needs a
   subscription (§3.5). This matters if an LLM ever reads the database or the dashboard.
4. **The terms-compatible path for a free account is the Bulk Data Export.** API
   Policy §6.6: every user may export their own data "free of charge, through the Bulk
   Data Export Tool". The flow is website → Settings → My Account → "Download your
   account" → emailed zip. The `activities/` folder holds the original files (some are
   gzipped). <https://support.strava.com/en-us/articles/15401919-how-do-i-export-my-strava-data>
   That data is the user's own export, not "Strava Data" obtained through the API.
   Not verified here: the exact columns of the archive's `activities.csv` (support
   pages do not name it). Check a real export.

The rest of this note answers the original questions. It applies only if the athlete
subscribes, or for anyone who already has an app.

## 1. Account, app and athlete capacity

- Creating an app needs a subscription (see above). Create it at
  <https://www.strava.com/settings/api>.
- New apps start in **Single Player Mode**, with an athlete capacity of 1: "Developers
  in Single Player Mode can use their app solely for themselves, and can access their
  own data." <https://developers.strava.com/docs/rate-limits/>
- You can self-upgrade to 10 athletes from the API Settings Dashboard (changelog,
  June 1, 2026: "self service expanded access"). More than 10 needs review.
  <https://developers.strava.com/docs/changelog/>

## 2. OAuth

Source: <https://developers.strava.com/docs/authentication/>

- **Scopes.** Ask for `activity:read_all`, which is `activity:read` plus "Only You"
  (private) activities and privacy-zone data. `activity:read` alone filters out Only
  You activities. Add `profile:read_all` only if you need athlete zones or the profile.
- **Authorize URL:**
  `GET https://www.strava.com/oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=activity:read_all&approval_prompt=force`
  - The athlete can untick scopes. Since April 23, 2026 the token response includes
    a space-delimited `scope` field (changelog), so check it.
- **Redirect.** `redirect_uri` "must be within the callback domain… localhost and
  127.0.0.1 are white-listed".
  - A local CLI can run a one-shot HTTP listener on `http://localhost:<port>/callback`.
  - Set the "Authorization Callback Domain" to `localhost` (getting-started).
- **Exchange.** `POST https://www.strava.com/oauth/token` with `client_id`,
  `client_secret`, `code` and `grant_type=authorization_code`.
  - The code is short-lived and single-use.
  - The response holds `access_token`, `expires_at`, `expires_in`, `refresh_token`
    and `athlete`.
- **Access token lifetime:** 6 hours.
- **Refresh.** Send the same endpoint `grant_type=refresh_token` plus `refresh_token`.
  - If the current access token has more than 1 hour left, you get the same token back.
  - Every response may return a **new refresh token**, and the old one stops working.
    Always persist the latest one.
- **Upcoming (effective June 1, 2027):** tokens must be sent in request headers
  (`Authorization: Bearer`), not form params. The base URL also moves from
  `https://www.strava.com/api/v3` to `https://api-v3.strava.com` (changelog; the staff
  post writes `www.api-v3.strava.com`).
  - Use the header from day one.
  - Keep the base URL in one constant.

## 3. Rate limits and import cost

Source: <https://developers.strava.com/docs/rate-limits/>

| | 15 min | daily |
|---|---|---|
| Overall, default | 200 | 2,000 |
| Read (non-upload), default | 100 | 1,000 |
| Overall, after self-upgrade to 10 athletes | 400 | 4,000 |
| Read, after self-upgrade | 200 | 2,000 |

- The 15-minute windows reset at :00, :15, :30 and :45. The daily limit resets at
  midnight UTC.
- Headers: `X-RateLimit-Limit/Usage` and `X-ReadRateLimit-Limit/Usage`. Each holds
  two values: 15-minute, then daily.
- Going over the limit returns `429`. Rejected requests still count toward the daily
  limit.
- API Policy §3.7 forbids circumventing the limits.

**Import cost for about 300 activities** (default read limits):

- **List:** 2 calls at `per_page=200`, plus 1 call to hit an empty page.
- **Detail** (`GET /activities/{id}`) for every activity: 300 calls. That is 3 full
  15-minute windows, so roughly 45 min or more of wall-clock time.
  - Only runs need detail, which makes this cheaper.
- **Streams** add 1 call per activity: about 600 calls in total. That still fits in
  one day (1,000 reads) but needs about 6 windows.
- **Laps** come inside the detailed activity, so no extra call is needed.
- **Incremental refresh:** usually 1 list call plus 1–2 per new activity.

## 4. Listing and incremental refresh

Source: `GET /athlete/activities` in <https://developers.strava.com/docs/reference/>

- `before` and `after` are epoch-second integers that filter on activity start time.
- `page` defaults to 1. `per_page` defaults to 30, with a maximum of 200.
- Pagination note: "the number of items returned… may be lower than the requested
  page size, even when that page is not the last… prefer iterating until an empty page
  is returned."
- Only You activities are filtered out unless the token has `activity:read_all`.
- For an incremental refresh, pass `after = <latest stored start_date> − small overlap`
  and upsert by `id`.
  - Edits and deletions of older activities are **not** detected this way.
  - Policy §6.3 requires reflecting deletions within 48h, which implies periodic
    re-listing.
- Since July 3, 2024, activities with a hidden start time return `00:00:01` as the
  time of day in `start_date` and `start_date_local` (changelog).

## 5. Fields

Schemas:
<https://developers.strava.com/swagger/activity.json> and
<https://developers.strava.com/swagger/sport_type.json>

**SummaryActivity** (what the list returns):

- Basics: `id`, `name`, `distance` (m), `moving_time` and `elapsed_time` (s),
  `total_elevation_gain`, `elev_high`/`elev_low`.
- Type: `sport_type` (`type` is deprecated).
- Time and place: `start_date`, `start_date_local`, `timezone`, `start_latlng`/`end_latlng`.
- Flags: `trainer`, `commute`, `manual`, `private`.
- Other: `workout_type`, `average_speed`, `max_speed`, `gear_id`, `map.summary_polyline`.
- `device_name` was added to the summary on Oct 27, 2025.
- The official list example also contains `average_cadence`, `has_heartrate`,
  `average_heartrate`, `max_heartrate`, `suffer_score` and `pr_count`. These are not
  in the swagger schema, so treat them as present but undocumented.

**DetailedActivity** adds:

- `description`, `calories`, `gear`, `segment_efforts`, `photos`.
- `splits_metric` and `splits_standard` ("for runs"). Each split has `distance`,
  `elapsed_time`, `moving_time`, `elevation_difference`, `average_speed` and
  `pace_zone`.
- `laps` (Lap: distance, times, speeds, `average_cadence`, `lap_index`, `start_index`/`end_index`).
- `best_efforts`, an array of `DetailedSegmentEffort`.
- The example also shows `average_temp`.

**`workout_type`** is an integer, but the reference does **not** document its enum.

- The example shows `10` on a ride and `null` on a manual activity.
- The run values commonly used (0 default, 1 race, 2 long run, 3 workout) do not
  appear in any primary source I found. Verify them against your own data.

**`sport_type`**: the full enum as of the April 30, 2026 additions:

- AlpineSki, BackcountrySki, Badminton, Basketball, Canoeing, Cricket, Crossfit,
  Dance, EBikeRide, Elliptical, EMountainBikeRide, Golf, GravelRide, Handcycle,
  HighIntensityIntervalTraining, Hike, IceSkate, InlineSkate, Kayaking, Kitesurf,
  MountainBikeRide, NordicSki, Padel, PhysicalTherapy, Pickleball, Pilates,
  Racquetball, Ride, RockClimbing, RollerSki, Rowing, Run, Sail, Skateboard,
  Snowboard, Snowshoe, Soccer, Squash, StairStepper, StandUpPaddling, Surfing, Swim,
  TableTennis, Tennis, TrailRun, Velomobile, VirtualRide, VirtualRow, VirtualRun,
  Volleyball, Walk, WeightTraining, Wheelchair, Windsurf, Workout, Yoga.
- The list grows over time, so store it as text rather than a closed enum.
- Runs for the dashboard: `Run`, `TrailRun`, `VirtualRun`.

**Streams.** `GET /activities/{id}/streams?keys=…&key_by_type=true` needs
`activity:read`, or `activity:read_all` for Only You activities.

- Available keys: `time`, `distance`, `latlng`, `altitude`, `velocity_smooth`,
  `heartrate`, `cadence`, `watts`, `temp`, `moving`, `grade_smooth`.
- Each stream returns `data`, `series_type`, `original_size` and `resolution`.

**Zones.** `GET /activities/{id}/zones` is marked "Summit Feature", meaning it needs
a subscription.

## Sources

- Getting started: <https://developers.strava.com/docs/getting-started/>
- Authentication: <https://developers.strava.com/docs/authentication/>
- Rate limits: <https://developers.strava.com/docs/rate-limits/>
- API reference: <https://developers.strava.com/docs/reference/>
- Swagger: <https://developers.strava.com/swagger/swagger.json>
- Changelog: <https://developers.strava.com/docs/changelog/>
- API Agreement (2026): <https://www.strava.com/legal/api>
- API Policy (2026): <https://www.strava.com/legal/api_policy>
- Developer program update (Strava staff, 2026-06-01): <https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428>
- Strava API FAQ (Strava staff): <https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906>
- Data export: <https://support.strava.com/en-us/articles/15401919-how-do-i-export-my-strava-data>
