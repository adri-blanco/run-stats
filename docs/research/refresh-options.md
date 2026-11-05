# Refreshing one or two new activities without a full export

Research for issue #10. Sources checked on 2026-11-05. Each claim cites the page
that owns it. The watch is a **Polar** (confirmed by the user), so the source-device
part covers Polar. Other vendors get one line each.

Context from `docs/research/strava-free-api.md` (branch `research/strava-free-api`):
the Strava API now needs a paid subscription, and its policy forbids a local archive.
The Bulk Data Export is free (API Policy §6.6).

## TL;DR

1. **Scraping strava.com is forbidden by the ToS, even for your own data and your own
   logged-in session.** Strava Terms of Service (2026), effective Sep 28, 2026, §19:
   "Automated access to or collection of data from the Services—by any means,
   including data mining, robots, screen scraping, scripts, or similar data-gathering
   tools or software such as browser extensions and crawlers—is prohibited." and
   "This prohibition applies regardless of whether you are logged into a Strava
   account". Also: "You agree not to access the Services by any means other than
   through the interfaces that are provided by Strava." <https://www.strava.com/legal/terms>
   Drop this option.
2. **Manual per-activity export from strava.com is allowed and seems free.** On the
   activity page, open the "…" menu and choose "Export Original" (the file as uploaded,
   often FIT) or "Export GPX". You can also add `/export_tcx` to the activity URL. It
   only works on the website. <https://support.strava.com/hc/en-us/articles/216918437>
   No Strava page says this needs a subscription, and the free-vs-subscription table on
   <https://www.strava.com/subscribe> has no export row. Not proven: no source states
   outright that it is free. Check by clicking it once on the free account.
3. **Strava has no free, sanctioned incremental feed.** Your options are the API
   (paid), the bulk export (a whole-account zip by email, "this may take a few hours")
   or per-activity export by hand. Strava's pages give no limit on how often you can
   request a bulk export. <https://support.strava.com/hc/en-us/articles/216918437>
4. **Polar AccessLink is the best automated route.** It is free, any Polar Flow user
   can register a client, it has OAuth2 with tokens that do not expire, and it has an
   endpoint that lists exercises plus FIT, TCX and GPX downloads. It gives HR and sport
   type. Limits: only exercises uploaded to Flow in the last 30 days, and none from
   before you registered your client. That is fine for refreshes of 1–2 activities.
   <https://www.polar.com/accesslink-api/>
5. **Polar data does not cover the full history, and it lacks Strava-only fields.**
   Phone-recorded activities from before about 2024 exist only in Strava. Strava's
   title, description, gear, kudos and segments are not in Polar data. A refresh from
   Polar has to be matched to the bulk-export rows (for example on start time).

## 1. Scraping strava.com (rejected)

- Terms: see TL;DR 1. The only exception in §19 is to "use any RSS feeds available on
  the Services, for personal use only". <https://www.strava.com/legal/terms>
- robots.txt disallows many activity sub-paths for all agents, including
  `/activities/*/heartrate`, `/laps`, `/split`, `/analysis`, plus `/api/`, `/stream/`
  and `/athlete/*`. <https://www.strava.com/robots.txt> The terms ban automated access
  whatever robots.txt says, so robots.txt does not matter here.
- Fragility, not verified (by design: no login or scraping attempted). The tool would
  have to copy a browser session cookie, which expires, and would break whenever the
  page markup changes. The terms risk alone rules it out.
- Risk if done anyway: the account could be suspended. It is the account that holds the
  only copy of the 2022–2024 phone history.

## 2. Manual "Export Original" from Strava, dropped into a folder

- How: open the activity on strava.com → "…" → **Export Original** (the original upload
  format, "often FIT") or **Export GPX** (GPS, time, HR, cadence). For TCX, add
  `/export_tcx` to the URL; "TCX export only works for activities with GPS data". GPX
  from an activity without GPS is "unreadable or empty". Website only, and only for
  your own activities. Source, last updated Sep 14, 2026:
  <https://support.strava.com/hc/en-us/articles/216918437>
- This is ordinary use of the interface, so the terms risk is nil.
- Effort: about 3 clicks per activity, plus one command to run the import. For 1–2
  activities, that is about a minute.
- Completeness: you get the same file as `activities/` in the bulk export. Strava-only
  fields (name, description, gear, etc.) are **not** in the file. They are only in the
  bulk export's `activities.csv`. The tool would need to work without them for these
  rows, or fill them in at the next bulk export.
- Fragility: low. If the menu moves, only a human is affected.

## 3. Repeating the Strava bulk export

- Free: API Policy §6.6 (see the earlier note). Steps: Settings → My Account →
  "Download your account" → "Request download" → link by email, "may take a few hours".
  <https://support.strava.com/hc/en-us/articles/216918437>
- No published limit on how often you can request one. Effort: a few clicks plus hours
  of waiting plus a large zip (about 300 activities). It is the only route that also
  refreshes Strava-only fields and edits. It suits a monthly "true-up", not every
  refresh.

## 4. Polar (source device)

### 4a. Polar AccessLink API (automated)

- **Eligibility and cost.** "Any registered Polar Flow user can create API client to
  AccessLink", through the admin portal (admin.polaraccesslink.com).
  <https://www.polar.com/accesslink-api/> Licence: "Polar Application Programming
  Interface (API) Limited License Agreement", latest update 22 Aug 2025. "At the moment
  Polar offers the use and activation of Polar API's free of charge", and Polar may
  charge fees later. <https://www.polar.com/en/legal/polar-api-agreement>
- **Licence points that matter for a personal local tool**
  (<https://www.polar.com/en/legal/polar-api-agreement>):
  - §2.1: a royalty-free limited licence for "proprietary application or services
    development". "Any other use of the Polar API is strictly prohibited."
  - §2.2: the app's primary purpose should be "extending and improving the Member's
    experience". You may not build "a service similar to or competing with Polar
    Ecosystem". A personal stats dashboard fits the first clause.
  - §3.1.1: no data may go to external sources without the member's permission. Here
    the member is the developer, so this is satisfied.
  - §8.4: when the agreement ends, you must "destroy and delete all copies of the
    Licensed Materials and Data". §8.3: Polar may end access "for any or no reason, with
    immediate effect". **This is a real risk to a local archive:** if the client is ever
    terminated, the licence says delete the data received through it. There is no
    retention or cache limit like Strava's 7 days.
  - The agreement is written for developers and companies. It does not single out
    individuals, but it does not exclude them either.
- **OAuth2 (v3)** (<https://www.polar.com/accesslink-api/>):
  - Authorize: `GET https://flow.polar.com/oauth2/authorization?response_type=code&client_id=…`
    with scope `accesslink.read_all`. The redirect URI must be identical to the one
    registered. The code is valid for 10 minutes and works once.
  - Token: `POST https://polarremote.com/v2/oauth2/token` with Basic
    `client_id:client_secret` and `grant_type=authorization_code`. "Access tokens will
    not expire unless explicitly revoked by partners or users". So the browser
    authorization runs **once**, and the tool keeps the token (in `.env` or similar).
  - Then register the user once: `POST https://www.polaraccesslink.com/v3/users` with
    `{"member-id": …}`. It returns 409 if the user is already registered.
  - Not verified: whether the admin portal accepts an `http://localhost` redirect URI.
    Check this when you register the client.
- **Fetching only new exercises (v3)**
  (<https://www.polar.com/accesslink-api/>):
  - `GET /v3/exercises` lists exercises. "Only Exercises uploaded to Flow in the last 30
    days are returned". Exercises uploaded before the user was registered with your
    client are excluded. Optional flags: `samples`, `zones`, `route`.
  - `GET /v3/exercises/{id}` returns one exercise. `/fit`, `/tcx` and `/gpx` return the
    files.
  - It is non-transactional, so for "new" the tool skips IDs it has already imported.
    The older `exercise-transactions` model (it returns each session once, then
    deletes it on commit) is marked "deprecated. Please use non-transactional
    Exercises instead".
  - Exercise fields include `start_time` (+ `start_time_utc_offset`), `duration` (ISO
    8601), `distance`, `heart_rate.average` / `.maximum`, `sport`,
    `detailed_sport_info`, `device` and `has_route`. The FIT file has the full HR, GPS
    and lap samples.
  - Rate limits: 500 + 20×users per 15 min and 5000 + 100×users per 24 h (≈520 and
    5100 for one user). Over the limit returns 429. A refresh uses a few requests.
  - The 30-day window means you must run a refresh at least monthly, or fall back to
    route 2/3 for older ones.
- **AccessLink v4** ("Dynamic API v4") also exists (<https://www.polar.com/polar-api-v4/>):
  - `GET https://www.polaraccesslink.com/v4/data/training-sessions/list` takes a
    `from`/`to` date range of up to 90 days. Session fields include `startTime`,
    `durationMillis`, `distanceMeters`, `hrAvg`, `hrMax`, `sport.id`, and the device
    model.
  - Its tokens last 12 hours and come with a refresh token. Rate limits: 3000 per
    15 min and 100000 per 24 h.
  - Not verified: whether v4 has FIT/TCX/GPX downloads (not seen in the parts read),
    whether v4 is GA, and whether v3 is being retired. v3 showed no retirement notice in
    the parts read. Start on v3. Look at v4 if v3 gets a deprecation notice.

### 4b. Polar Flow manual export

- Per session: Flow web → Diary → open the session → **Export** menu → TCX, CSV, FIT,
  GPX or a zip. Routes come as GPX/FIT. HR, calories and cadence come as TCX/CSV/FIT.
  <https://support.polar.com/en/export-training-sessions-flow>
- Full account: account.polar.com → "Download your data". You get an email when it is
  ready, and you have 2 weeks to download it. Polar says it "is not a mass loader for
  exercises", and derived data such as activity and sleep is not included.
  <https://support.polar.com/en/how-to-download-all-your-data-from-polar-flow>
- Effort and risk are the same as Strava's manual export (route 2), but it only covers
  Polar-recorded sessions. No advantage over route 2, except as a backup if Strava
  becomes unavailable.
- Polar Terms of Use (updated 18 Feb 2026) have no clause on scraping or automated
  access, but they forbid circumventing "security or other technical features".
  <https://www.polar.com/en/legal/terms-of-use> Use AccessLink, not Flow web scraping.

## 5. Other vendors (one line each, the user has a Polar)

- Garmin: the Garmin Connect Developer Program now has a **Personal** tier. It is a
  self-serve API key for "individual Garmin users who want programmatic access to their
  own data", with pull-only access to activities in JSON and FIT.
  <https://developer.garmin.com/gc-developer-program/personal/personal-faq/>
- Coros, Suunto: not researched (not the user's device).
- Apple Health: not researched. Only relevant if the Polar syncs there and nothing else
  works.

## 6. Comparison

| Route | Effort per refresh | Data completeness | Terms risk | Fragility |
|---|---|---|---|---|
| Scrape strava.com | none once built | full page data | **Prohibited** (ToS §19) | high (session, markup, bot detection) |
| Strava "Export Original" by hand | ~1 min, 3 clicks/activity | original file (HR, GPS, laps). No Strava-only fields | none | low |
| Strava bulk export | clicks + hours + big zip | everything, incl. `activities.csv` | none (§6.6) | low |
| Polar AccessLink v3 | zero (run a command) | FIT/TCX/GPX + summary (HR, sport). No Strava fields, Polar-recorded only, last 30 days | low. Free "at the moment". Delete-on-termination clause (§8.4) | low–medium (API versions can change, v4 exists) |
| Polar Flow manual export | ~1 min/session | as AccessLink | none | low |

## Recommendation

- **History:** one Strava bulk export (already planned). It is the only source for
  2022–2024 phone activities and for Strava-only fields.
- **Routine refresh:** Polar AccessLink v3. Run a one-time OAuth in the browser and
  keep the non-expiring token locally. Each refresh lists `/v3/exercises`, skips known
  IDs, and downloads FIT for new ones. Match to existing rows by start time ± a few
  minutes, so the same run is not stored twice once the next Strava bulk export
  contains it.
- **Fallback / no-code option:** drop Strava "Export Original" files into an inbox
  folder. It has zero terms risk and needs no client registration.
- **Occasional Strava bulk export** (for example monthly or quarterly) to pick up
  titles, gear and edits.

## What would change the plan

- The Polar admin portal refuses localhost redirect URIs or individual registrations.
  Then fall back to manual export.
- Polar starts charging for AccessLink (§ "reserves the right to charge fees"), or v3
  is retired.
- The dashboard needs Strava-only fields (titles, gear, segments) to be current after
  each refresh. Then only the bulk export works, and a Polar refresh shows those rows
  without these fields until the next bulk export.
- "Export Original" turns out to be subscription-only on the free account. Check by
  clicking it once.
- Anyone (or any LLM) reading the DB: Polar's licence has no AI clause like Strava's
  §5.3, but Strava-sourced rows still come from the bulk export. That is the user's own
  export, not API data.
