import Chart, { type ChartDataset, type Plugin, type ScaleOptions, type TooltipItem } from "chart.js/auto";
import type { ActivityRow, CurrentLevel, DashboardData, Period, StreakBasis, TrendBucket } from "../metrics";

const { activities, currentLevel, allTime, streaks, trends, meta }: DashboardData = JSON.parse(document.getElementById("data")!.textContent!);

function el(tag: string, className: string, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

function duration(seconds: number): string {
  const [h, m, s] = [seconds / 3600, (seconds % 3600) / 60, seconds % 60].map(Math.floor);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Shorter than the table's durations: 25:19, not 0:25:19.
const effort = (seconds: number | null) => (seconds === null ? "–" : duration(seconds).replace(/^0:0?/, ""));
const km = (run: ActivityRow | null) => (run === null ? "–" : (run.distanceM / 1000).toFixed(1));

const titleOf = (a: ActivityRow) => a.title ?? `${a.type[0]!.toUpperCase()}${a.type.slice(1)}, from Polar`;

function big(value: string, label: string, line: string): HTMLElement {
  return el("div", "big", el("b", "num", value), el("span", "", label), el("small", "", line));
}

function bigNumbers(level: CurrentLevel): HTMLElement[] {
  return [
    big(effort(level.best5k), "best 5K", `all-time ${effort(allTime.best5k)}`),
    big(effort(level.best10k), "best 10K", `all-time ${effort(allTime.best10k)}`),
    big(effort(level.best1k), "best 1K", `all-time ${effort(allTime.best1k)}`),
    big(km(level.longestRun), "km longest run", `all-time ${km(allTime.longestRun)} km`),
    big(String(level.longRuns), "long runs", `in ${level.weeksWithLongRun} of ${level.weeks} weeks`),
  ];
}

type Rows = [label: string, value: string][];

function rows(list: Rows): HTMLElement[] {
  return list.map(([label, value]) => el("div", "", el("span", "", label), el("b", "", value)));
}

function card(heading: string, a: ActivityRow | null): HTMLElement {
  if (!a) return el("div", "", el("h3", "", heading), el("small", "", "–"));
  const facts: Rows = [
    ["Distance", `${km(a)} km`],
    ["Time", effort(a.movingS)],
    ["Pace", a.paceSPerKm === null ? "–" : `${pace(a.paceSPerKm)} /km`],
    ["Time stopped", effort(a.stoppedS)],
  ];
  return el(
    "div",
    "",
    el("h3", "", heading),
    el("div", "race", el("b", "", activityLink(a)), el("small", "", a.date)),
    el("div", "lvl num", ...rows(facts)),
  );
}

function cards(level: CurrentLevel): HTMLElement[] {
  return [
    card("Fastest 5K race", allTime.fastest5kRace),
    card("Fastest 7K race", allTime.fastest7kRace),
    card("Fastest 10K race", allTime.fastest10kRace),
    card("Longest run", level.longestRun),
  ];
}

function hoursMinutes(seconds: number): string {
  return `${Math.floor(seconds / 3600)} h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
}

function change(percent: number): string {
  const whole = Math.round(percent);
  return `${whole > 0 ? "+" : ""}${whole}%`;
}

function volume(level: CurrentLevel): HTMLElement[] {
  const compared: Rows = level.weeklyDistanceChangePct === null ? [] : [["vs previous period", change(level.weeklyDistanceChangePct)]];
  return rows([
    ["Weekly distance", `${(level.weeklyDistanceM / 1000).toFixed(1)} km`],
    ...compared,
    ["Total distance", `${(level.totalDistanceM / 1000).toFixed(0)} km`],
    ["Time running", hoursMinutes(level.timeRunningS)],
    ["Runs per week", level.runsPerWeek.toFixed(1)],
    ["Cross-training per week", level.crossTrainingPerWeek.toFixed(1)],
  ]);
}

function consistency(level: CurrentLevel, basis: StreakBasis): HTMLElement[] {
  return rows([
    ["Current streak", `${streaks[basis].current} wk`],
    ["Longest streak ever", `${streaks[basis].longest} wk`],
    ["Runs in period", String(level.runs)],
    ["Weeks with a long run", `${level.weeksWithLongRun} of ${level.weeks}`],
  ]);
}

// Calls onChange straight away with the initial value.
function segmented<T extends string>(label: string, options: [T, string][], initial: T, onChange: (value: T) => void): HTMLElement {
  const buttons = options.map(([value, text]) => {
    const button = el("button", "", text);
    button.onclick = () => choose(value);
    return button;
  });
  const choose = (value: T) => {
    buttons.forEach((button, i) => {
      const on = options[i]![0] === value;
      button.className = on ? "on" : "";
      button.setAttribute("aria-pressed", String(on));
    });
    onChange(value);
  };
  choose(initial);
  const selector = el("span", "seg", ...buttons);
  selector.setAttribute("role", "group");
  selector.setAttribute("aria-label", label);
  return selector;
}

function rightNow(): HTMLElement[] {
  const numbers = el("div", "huge");
  const volumeRows = el("div", "lvl num");
  const consistencyRows = el("div", "lvl num");
  const raceCards = el("div", "contents");
  const recent = el("tbody", "");
  const shown: { period: Period; basis: StreakBasis } = { period: "8w", basis: "runs" };
  const draw = () => {
    const level = currentLevel[shown.period];
    numbers.replaceChildren(...bigNumbers(level));
    volumeRows.replaceChildren(...volume(level));
    consistencyRows.replaceChildren(...consistency(level, shown.basis));
    raceCards.replaceChildren(...cards(level));
    recent.replaceChildren(...level.recent.map(row));
  };
  const periods: [Period, string][] = [["3w", "3 wk"], ["8w", "8 wk"], ["3m", "3 mo"], ["1y", "1 yr"], ["all", "All"]];
  const periodSelector = segmented("Period", periods, shown.period, (period) => {
    shown.period = period;
    draw();
  });
  const streakSelector = segmented("Streak basis", [["runs", "Runs"], ["all", "Any activity"]], shown.basis, (basis) => {
    shown.basis = basis;
    draw();
  });
  const awaiting = `${meta.awaitingStrava} recent ${meta.awaitingStrava === 1 ? "activity" : "activities"} awaiting Strava details`;
  const labels = el("tr", "", ...COLUMNS.map(({ label }) => el("th", "", label)));
  return [
    el("div", "now", el("h2", "", "Right now"), periodSelector),
    numbers,
    el(
      "div",
      "groups",
      el("div", "", el("h3", "", "Volume"), volumeRows),
      el("div", "", el("div", "head", el("h3", "", "Consistency"), streakSelector), consistencyRows),
      raceCards,
    ),
    el("h3", "recent", "Recent activities"),
    el("table", "acts", el("thead", "", labels), recent),
    ...(meta.awaitingStrava ? [el("small", "awaiting", awaiting)] : []),
  ];
}

function pace(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function activityLink(a: ActivityRow): Node | string {
  if (!a.stravaId) return titleOf(a);
  const link = el("a", "", titleOf(a)) as HTMLAnchorElement;
  link.href = `https://www.strava.com/activities/${a.stravaId}`;
  link.target = "_blank";
  link.rel = "noopener";
  return link;
}

function row(a: ActivityRow): HTMLElement {
  return el(
    "tr",
    "",
    el("td", "num", a.date),
    el(
      "td",
      "",
      activityLink(a),
      ...(a.race ? [el("span", "tag race", "race")] : []),
      ...(a.longRun ? [el("span", "tag", "long run")] : []),
      ...(a.sessionType ? [el("span", "tag session", a.sessionType)] : []),
      ...(a.stravaId ? [] : [el("span", "tag", "not on Strava yet")]),
    ),
    el("td", "", a.type),
    el("td", "num", a.distanceM ? `${(a.distanceM / 1000).toFixed(1)} km` : "–"),
    el("td", "num", a.movingS ? duration(a.movingS) : "–"),
    el("td", "num", a.paceSPerKm === null ? "–" : pace(a.paceSPerKm)),
    el("td", "num", a.avgHr === null ? "–" : String(Math.round(a.avgHr))),
  );
}

type Value = string | number | null;
type Column = { label: string; value: (a: ActivityRow) => Value; ascendingFirst?: boolean };

// A 0 shows as "–", so it counts as empty when sorting.
const COLUMNS: Column[] = [
  { label: "Date", value: (a) => a.date },
  { label: "Activity", value: (a) => titleOf(a) || null, ascendingFirst: true },
  { label: "Type", value: (a) => a.type, ascendingFirst: true },
  { label: "Distance", value: (a) => a.distanceM || null },
  { label: "Time", value: (a) => a.movingS || null },
  { label: "Pace", value: (a) => a.paceSPerKm, ascendingFirst: true },
  { label: "HR", value: (a) => a.avgHr },
];

const PAGE_SIZE = 40;
const view = { column: COLUMNS[0]!, direction: -1, limit: PAGE_SIZE };

function compare(a: Value, b: Value): number {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  const order = typeof a === "string" ? a.localeCompare(b as string) : a - (b as number);
  return order * view.direction;
}

function select(label: string, values: string[]): HTMLSelectElement {
  const node = el("select", "", el("option", "", label), ...values.map((v) => el("option", "", v))) as HTMLSelectElement;
  node.setAttribute("aria-label", label);
  (node.firstChild as HTMLOptionElement).value = "";
  node.addEventListener("change", refilter);
  return node;
}

const distinct = (value: (a: ActivityRow) => string | null) =>
  [...new Set(activities.map(value))].filter((v) => v !== null);

const typeFilter = select("Any type", distinct((a) => a.type));
const markFilter = select("Any mark", ["Races", "Long runs"]);
const sessionFilter = select("Any session type", distinct((a) => a.sessionType).sort());
const yearFilter = select("Any year", distinct((a) => a.date.slice(0, 4)));
const search = el("input", "") as HTMLInputElement;
search.type = "search";
search.placeholder = "Search titles";
search.setAttribute("aria-label", "Search titles");
search.addEventListener("input", refilter);

function matches(a: ActivityRow): boolean {
  return (
    (!typeFilter.value || a.type === typeFilter.value) &&
    (!markFilter.value || (markFilter.value === "Races" ? a.race : a.longRun)) &&
    (!sessionFilter.value || a.sessionType === sessionFilter.value) &&
    (!yearFilter.value || a.date.startsWith(yearFilter.value)) &&
    titleOf(a).toLowerCase().includes(search.value.toLowerCase())
  );
}

const count = el("small", "");
const body = el("tbody", "");
const more = el("button", "more", "Show more") as HTMLButtonElement;
more.addEventListener("click", () => {
  view.limit += PAGE_SIZE;
  draw();
});

// Headers stay in place between draws, so a sort button keeps keyboard focus.
const headers = COLUMNS.map((column) => {
  const button = el("button", "", column.label);
  button.addEventListener("click", () => {
    view.direction = view.column === column ? -view.direction : column.ascendingFirst ? 1 : -1;
    view.column = column;
    refilter();
  });
  return el("th", "", button);
});

function draw(): void {
  const { value } = view.column;
  // The sort is stable, so ties stay newest first.
  const shown = activities.filter(matches).sort((a, b) => compare(value(a), value(b)));
  count.textContent = `Showing ${Math.min(view.limit, shown.length)} of ${shown.length} activities`;
  body.replaceChildren(...shown.slice(0, view.limit).map(row));
  more.hidden = shown.length <= view.limit;
  headers.forEach((th, i) => {
    const on = COLUMNS[i] === view.column;
    th.setAttribute("aria-sort", !on ? "none" : view.direction > 0 ? "ascending" : "descending");
  });
}

function refilter(): void {
  view.limit = PAGE_SIZE;
  draw();
}

Chart.defaults.animation = false;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.font.size = 11;

const VIOLET = "#5b3fd6";
const PINK = "#e0257f";
// One width for every chart, so their plots start at the same x and the time axes line up.
const Y_AXIS_WIDTH = 64;
const HALF_MARATHON_KM = 21.1;
const ZONE_COLORS = ["#cfd8e3", "#8fc1a9", "#efcf6b", "#e8964e", "#c8421f"];

// Shades whole phone buckets only: the bucket the watch era starts in may hold HR data.
const phoneEra: Plugin = {
  id: "phoneEra",
  beforeDraw({ ctx, data, chartArea: { left, top, height }, scales }) {
    // A month key sorts before any date in that month, so this also finds the month holding the start.
    const watchBucket = (data.labels as string[]).findLastIndex((key) => key <= meta.watchEraStart);
    if (watchBucket < 1) return;
    ctx.save();
    ctx.fillStyle = "#eceef1";
    ctx.fillRect(left, top, scales.x!.getPixelForValue(watchBucket - 0.5) - left, height);
    ctx.restore();
  },
};

const halfMarathonLine: Plugin = {
  id: "halfMarathonLine",
  afterDatasetsDraw({ ctx, chartArea: { left, right }, scales }) {
    const y = scales.y!.getPixelForValue(HALF_MARATHON_KM);
    ctx.save();
    ctx.strokeStyle = PINK;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = "#1c2024";
    ctx.font = `600 11px ${Chart.defaults.font.family}`;
    ctx.textAlign = "right";
    ctx.fillText(`${HALF_MARATHON_KM} km half marathon`, right, y - 5);
    ctx.restore();
  },
};

// Drawn level in the band above the plot: an axis title is rotated, which would point the arrow sideways.
const fasterUp: Plugin = {
  id: "fasterUp",
  afterDraw({ ctx }) {
    ctx.save();
    ctx.fillStyle = "#667";
    ctx.font = `600 11px ${Chart.defaults.font.family}`;
    ctx.fillText("faster ↑", 0, 14);
    ctx.restore();
  },
};

type TrendChart = {
  title: string;
  note: string;
  tall?: boolean;
  type: "bar" | "line";
  datasets: (buckets: TrendBucket[]) => ChartDataset[];
  tooltip: (item: TooltipItem<"bar" | "line">) => string;
  y?: ScaleOptions<"linear">;
  legend?: boolean;
  stacked?: boolean;
  topPadding?: number;
  plugins?: Plugin[];
};

const kmBars = (buckets: TrendBucket[], metres: (bucket: TrendBucket) => number | null): ChartDataset[] => [
  { data: buckets.map((bucket) => (metres(bucket) === null ? null : metres(bucket)! / 1000)), backgroundColor: VIOLET, borderRadius: 4 },
];
const kmTooltip = (item: TooltipItem<"bar" | "line">) => `${item.parsed.y!.toFixed(1)} km`;

function effortLine(buckets: TrendBucket[], label: string, field: "best5k" | "best10k", color: string): ChartDataset {
  return {
    type: "line",
    label,
    data: buckets.map((bucket) => bucket[field]?.seconds ?? null),
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    spanGaps: true,
    pointStyle: buckets.map((bucket) => (bucket[field]?.race ? "triangle" : "circle")),
    pointRadius: buckets.map((bucket) => (bucket[field]?.race ? 6 : 2.5)),
  };
}

// Left unconnected across null buckets, so missing HR reads as a gap and not as a fall.
const hrLine = (buckets: TrendBucket[], value: (bucket: TrendBucket) => number | null, color: string): ChartDataset[] => [
  { data: buckets.map(value), borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 2.5 },
];

const TREND_CHARTS: TrendChart[] = [
  {
    title: "Run distance",
    note: "km per period",
    type: "bar",
    datasets: (buckets) => kmBars(buckets, (bucket) => bucket.runDistanceM),
    tooltip: kmTooltip,
  },
  {
    title: "Longest run",
    note: "km, line at half-marathon distance",
    tall: true,
    type: "bar",
    datasets: (buckets) => kmBars(buckets, (bucket) => bucket.longestRunM),
    tooltip: kmTooltip,
    y: { suggestedMax: HALF_MARATHON_KM + 2 } as ScaleOptions<"linear">,
    plugins: [halfMarathonLine],
  },
  {
    title: "Best 5K and 10K efforts",
    note: "up is faster, triangles are races",
    tall: true,
    type: "line",
    datasets: (buckets) => [effortLine(buckets, "5K", "best5k", VIOLET), effortLine(buckets, "10K", "best10k", PINK)],
    tooltip: (item) => {
      const race = (item.dataset.pointStyle as string[])[item.dataIndex] === "triangle";
      return `${item.dataset.label}: ${effort(item.parsed.y)}${race ? " (race)" : ""}`;
    },
    y: { reverse: true, ticks: { stepSize: 300, callback: (value) => effort(Number(value)) } } as ScaleOptions<"linear">,
    legend: true,
    plugins: [fasterUp],
  },
  {
    title: "Time in zones",
    note: "hours per period, activities with HR",
    type: "bar",
    datasets: (buckets) =>
      ZONE_COLORS.map((color, zone) => ({
        label: `Z${zone + 1}`,
        data: buckets.map((bucket) => (bucket.zoneSeconds ? bucket.zoneSeconds[zone]! / 3600 : null)),
        backgroundColor: color,
      })),
    tooltip: (item) => `${item.dataset.label}: ${item.parsed.y!.toFixed(1)} h`,
    legend: true,
    stacked: true,
  },
  {
    title: "Efficiency",
    note: "metres per heartbeat, up is better",
    type: "line",
    datasets: (buckets) => hrLine(buckets, (bucket) => bucket.efficiency, VIOLET),
    tooltip: (item) => `${item.parsed.y!.toFixed(2)} m/beat`,
  },
  {
    title: "Zone 2 pace",
    note: "min/km, runs over half in Zone 2, up is faster",
    type: "line",
    datasets: (buckets) => hrLine(buckets, (bucket) => bucket.zone2PaceSPerKm, VIOLET),
    tooltip: (item) => `${pace(item.parsed.y!)} /km`,
    y: { reverse: true, ticks: { stepSize: 30, callback: (value) => pace(Number(value)) } } as ScaleOptions<"linear">,
    topPadding: 26,
    plugins: [fasterUp],
  },
  {
    title: "Average HR",
    note: "bpm, runs with HR",
    type: "line",
    datasets: (buckets) => hrLine(buckets, (bucket) => bucket.avgHr, PINK),
    tooltip: (item) => `${Math.round(item.parsed.y!)} bpm`,
  },
];

function trendChart(def: TrendChart, canvas: HTMLCanvasElement): Chart {
  return new Chart(canvas, {
    type: def.type,
    data: { datasets: [] },
    plugins: [phoneEra, ...(def.plugins ?? [])],
    options: {
      // autoPadding would inset line charts by their point size and break the shared axis.
      layout: { autoPadding: false, padding: { top: def.topPadding ?? 0 } },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: !!def.legend, position: "top", align: "end", labels: { boxWidth: 9, boxHeight: 9, padding: 6 } },
        tooltip: {
          callbacks: {
            title: ([item]) => `${item!.label.length > 7 ? "Week of " : ""}${item!.label}`,
            label: def.tooltip,
          },
        },
      },
      scales: {
        // offset keeps line points over the bars' centres, on the same x as every other chart.
        x: {
          offset: true,
          stacked: def.stacked,
          grid: { display: false },
          ticks: {
            maxTicksLimit: 9,
            maxRotation: 0,
            callback(value) {
              return this.getLabelForValue(Number(value)).slice(0, 7);
            },
          },
        },
        y: {
          stacked: def.stacked,
          grid: { color: "#eee" },
          ticks: { maxTicksLimit: 5 },
          afterFit: (scale) => void (scale.width = Y_AXIS_WIDTH),
          ...def.y,
        } as ScaleOptions<"linear">,
      },
    },
  });
}

function theStorySoFar(): HTMLElement[] {
  const options: [keyof typeof trends, string][] = [["month", "Monthly"], ["week", "Weekly"]];
  const canvases = TREND_CHARTS.map((def) => {
    const canvas = el("canvas", "") as HTMLCanvasElement;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${def.title}, ${def.note}`);
    return canvas;
  });
  const charts = TREND_CHARTS.map((def, i) => trendChart(def, canvases[i]!));
  const selector = segmented("Chart period", options, "month", (unit) => {
    charts.forEach((chart, i) => {
      chart.data = { labels: trends[unit].map((bucket) => bucket.key), datasets: TREND_CHARTS[i]!.datasets(trends[unit]) };
      chart.update();
    });
  });
  return [
    el("h2", "story", "The story so far"),
    el("small", "", "Grey area: phone era, no heart rate."),
    el("div", "filters", selector),
    ...TREND_CHARTS.map((def, i) =>
      el(
        "div",
        def.tall ? "row tall" : "row",
        el("h3", "", def.title, el("small", "", def.note)),
        el("div", "chartbox", canvases[i]!),
      ),
    ),
  ];
}

const runs = activities.filter((a) => a.type === "run").length;
const range = activities.length ? `, ${activities.at(-1)!.date} to ${activities[0]!.date}` : "";

document.getElementById("app")!.append(
  el(
    "div",
    "night",
    el(
      "div",
      "inner",
      el("h1", "", "Adri's running"),
      el("small", "", `${runs} runs and ${activities.length - runs} other sessions${range}`),
      ...rightNow(),
    ),
  ),
  el(
    "div",
    "content",
    ...theStorySoFar(),
    el("h2", "story", "All activities"),
    el("div", "filters", typeFilter, markFilter, sessionFilter, yearFilter, search),
    count,
    el("table", "acts", el("thead", "", el("tr", "", ...headers)), body),
    more,
  ),
);

draw();
