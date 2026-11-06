import type { ActivityRow, CurrentLevel, DashboardData, Period } from "../metrics";

const { activities, currentLevel, allTime }: DashboardData = JSON.parse(document.getElementById("data")!.textContent!);

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
const km = (metres: number | null) => (metres === null ? "–" : (metres / 1000).toFixed(1));

function big(value: string, label: string, line: string): HTMLElement {
  return el("div", "big", el("b", "num", value), el("span", "", label), el("small", "", line));
}

function bigNumbers(level: CurrentLevel): HTMLElement[] {
  return [
    big(effort(level.best5k), "best 5K", `all-time ${effort(allTime.best5k)}`),
    big(effort(level.best10k), "best 10K", `all-time ${effort(allTime.best10k)}`),
    big(effort(level.best1k), "best 1K", `all-time ${effort(allTime.best1k)}`),
    big(km(level.longestRunM), "km longest run", `all-time ${km(allTime.longestRunM)} km`),
    big(String(level.longRuns), "long runs", `in ${level.weeksWithLongRun} of ${level.weeks} weeks`),
  ];
}

function rightNow(): HTMLElement[] {
  const options: [Period, string][] = [["3w", "3 wk"], ["8w", "8 wk"], ["3m", "3 mo"], ["1y", "1 yr"], ["all", "All"]];
  const numbers = el("div", "huge");
  const buttons = options.map(([period, label]) => {
    const button = el("button", "", label);
    button.onclick = () => select(period);
    return button;
  });
  const select = (period: Period) => {
    buttons.forEach((button, i) => {
      const on = options[i]![0] === period;
      button.className = on ? "on" : "";
      button.setAttribute("aria-pressed", String(on));
    });
    numbers.replaceChildren(...bigNumbers(currentLevel[period]));
  };
  select("8w");
  const selector = el("span", "seg", ...buttons);
  selector.setAttribute("role", "group");
  selector.setAttribute("aria-label", "Period");
  return [el("div", "now", el("h2", "", "Right now"), selector), numbers];
}

function row(a: ActivityRow): HTMLElement {
  return el(
    "tr",
    "",
    el("td", "num", a.date),
    el(
      "td",
      "",
      a.title,
      ...(a.race ? [el("span", "tag race", "race")] : []),
      ...(a.longRun ? [el("span", "tag", "long run")] : []),
      ...(a.sessionType ? [el("span", "tag session", a.sessionType)] : []),
    ),
    el("td", "", a.type),
    el("td", "num", a.distanceM ? `${(a.distanceM / 1000).toFixed(1)} km` : "–"),
    el("td", "num", duration(a.movingS)),
    el("td", "num", a.avgHr === null ? "" : String(Math.round(a.avgHr))),
  );
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
    el(
      "table",
      "acts",
      el("thead", "", el("tr", "", ...["Date", "Activity", "Type", "Distance", "Time", "HR"].map((h) => el("th", "", h)))),
      el("tbody", "", ...activities.map(row)),
    ),
  ),
);
