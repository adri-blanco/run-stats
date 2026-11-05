import Chart from "chart.js/auto";

new Chart(document.querySelector("canvas")!, {
  type: "line",
  data: { labels: ["a", "b", "c"], datasets: [{ label: "km", data: [3, 7, 5] }] },
  options: { animation: false, responsive: false },
});
