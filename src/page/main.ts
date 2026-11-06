import type { ActivityRow, CurrentLevel, DashboardData, Period, StreakBasis } from "../metrics";

const { activities, currentLevel, allTime, streaks }: DashboardData = JSON.parse(document.getElementById("data")!.textContent!);

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
  ];
}

function pace(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function activityLink(a: ActivityRow): Node | string {
  if (!a.stravaId) return a.title;
  const link = el("a", "", a.title) as HTMLAnchorElement;
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
  { label: "Activity", value: (a) => a.title || null, ascendingFirst: true },
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
    a.title.toLowerCase().includes(search.value.toLowerCase())
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
    el("h2", "story", "All activities"),
    el("div", "filters", typeFilter, markFilter, sessionFilter, yearFilter, search),
    count,
    el("table", "acts", el("thead", "", el("tr", "", ...headers)), body),
    more,
  ),
);

draw();
