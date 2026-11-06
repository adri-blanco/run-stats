# Ending the Polar agreement

Polar's API licence (§8.4) says that when the agreement ends, all copies of the licensed materials and data must be destroyed and deleted. Polar can end access at any time (§8.3). `refresh` is the only way Polar data gets in, and the Strava history stays. Text of the licence: <https://www.polar.com/en/legal/polar-api-agreement>.

If the agreement ends, from the repo root:

1. Delete the Polar-sourced rows. Their stored FIT files and derived values cascade, but only with `foreign_keys` on. `VACUUM` clears the deleted bytes out of the database file.

   ```sh
   sqlite3 run-stats.sqlite "PRAGMA foreign_keys = ON; DELETE FROM activity WHERE source = 'polar'; VACUUM;"
   ```

2. Rebuild the page, so it no longer carries those activities.

   ```sh
   bun src/cli.ts generate
   ```

3. Replace or delete every other copy: any `dashboard.html` put on a static host or sent as a PDF, and any backup of `run-stats.sqlite`.
4. Remove `POLAR_ACCESS_TOKEN` and any other Polar credentials from `.env`.
5. Stop using `refresh`.

Activities a Bulk export has adopted are `source = 'strava'` and hold no Polar data, so they stay.
