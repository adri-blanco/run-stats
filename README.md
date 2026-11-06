<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/logo/run-stats-header.svg">
    <img src="design/logo/run-stats-header-indigo.svg" alt="run-stats" width="494">
  </picture>
</p>

Turns your Strava history and recent Polar watch sessions into a single static HTML dashboard to show your trainer. The page answers three questions, in order: current level, trajectory over time and biggest achievements. Together they give evidence for judging whether a half marathon is a suitable next goal; it never gives a verdict or a predicted time.

Everything stays on your machine: activities live in a local SQLite file, and the dashboard is one self-contained HTML file you can host anywhere or print to PDF.

## Setup

Requires [Bun](https://bun.sh).

```bash
bun install
```

Edit [`settings.json`](settings.json) with your own values:

| Key                   | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `timeZone`            | IANA time zone, e.g. `Europe/Madrid`                                    |
| `hrZones`             | Five rising heart-rate values, in bpm                                   |
| `firstBarrierSeconds` | Times in seconds that earn a "first" achievement, for `1K`, `5K`, `10K` |

To use `refresh`, add a [Polar AccessLink](https://www.polar.com/accesslink-api/) token to `.env`:

```
POLAR_ACCESS_TOKEN=your-token
```

## Usage

Every command updates `run-stats.sqlite` as needed and writes the page to `dist/dashboard.html`.

**Import** a Strava bulk export, the zip Strava emails you on request. Do this first, and again whenever you want to bring in a newer full export:

```bash
bun src/cli.ts import path/to/export.zip
```

The export is treated as the full history: activities missing from it are deleted, except those only known from Polar so far. A zip older than what is already stored is refused.

**Refresh** adds new exercises from Polar. Polar only lists the last 30 days, and these activities stay provisional, with no title, until a bulk export adopts them:

```bash
bun src/cli.ts refresh
```

**Generate** rebuilds the page from what is already stored, for example after changing `settings.json`:

```bash
bun src/cli.ts generate
```

## Development

```bash
bun test
```

```bash
bun run typecheck
```

Domain terms are defined in [`GLOSSARY.md`](GLOSSARY.md). If your Polar agreement ends, follow [`docs/polar-licence.md`](docs/polar-licence.md).
