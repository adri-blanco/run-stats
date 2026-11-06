import type { ActivityRow, DashboardData } from "../metrics";

const { activities }: DashboardData = JSON.parse(document.getElementById("data")!.textContent!);

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
    ),
  ),
  el(
    "div",
    "content",
    el("h2", "story", "All activities"),
    el(
      "table",
      "acts",
      el("thead", "", el("tr", "", ...["Date", "Activity", "Type", "Distance", "Time"].map((h) => el("th", "", h)))),
      el("tbody", "", ...activities.map(row)),
    ),
  ),
);
