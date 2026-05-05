const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = {
  "24h": document.querySelector("#view-24h"),
  "7d": document.querySelector("#view-7d"),
  "30d": document.querySelector("#view-30d")
};
const summary = document.querySelector("#summary");
const summaryText = document.querySelector("#summary-text");
const updatedAt = document.querySelector("#updated-at");
const targetCount = document.querySelector("#target-count");
const retentionDays = document.querySelector("#retention-days");

let latestData = null;

const formatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "medium"
});

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return formatter.format(date);
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return null;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}j ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${Math.max(minutes, 0)}m`;
}

function percent(value) {
  return `${value.toFixed(2).replace(".", ",")} %`;
}

function incidentIntervals(data, targetKey, windowStart, windowEnd) {
  const incidents = Array.isArray(data.incidents) ? data.incidents : [];
  return incidents
    .filter((incident) => incident.target_key === targetKey)
    .map((incident) => {
      const startedAt = parseDate(incident.started_at);
      const endedAt = parseDate(incident.ended_at) || windowEnd;
      if (!startedAt || endedAt <= windowStart || startedAt >= windowEnd) {
        return null;
      }
      return {
        ...incident,
        start: new Date(Math.max(startedAt.getTime(), windowStart.getTime())),
        end: new Date(Math.min(endedAt.getTime(), windowEnd.getTime()))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function overlapSeconds(intervals, start, end) {
  return intervals.reduce((total, interval) => {
    const overlapStart = Math.max(start.getTime(), interval.start.getTime());
    const overlapEnd = Math.min(end.getTime(), interval.end.getTime());
    return total + Math.max(0, overlapEnd - overlapStart) / 1000;
  }, 0);
}

function buildHead(target) {
  const isDown = target.status === "down";
  const head = document.createElement("div");
  head.className = "status-head";

  const name = document.createElement("h2");
  name.className = "status-name";
  name.textContent = target.label || target.key || "Tracker";

  const badge = document.createElement("span");
  badge.className = "badge";

  const dot = document.createElement("span");
  dot.className = "status-dot";
  dot.setAttribute("aria-hidden", "true");

  const badgeText = document.createElement("span");
  badgeText.textContent = isDown ? "Hors ligne" : "En ligne";

  badge.append(dot, badgeText);
  head.append(name, badge);
  return head;
}

function render24h(data) {
  const now = parseDate(data.updated_at) || new Date();
  const windowStart = new Date(now.getTime() - 24 * 3600 * 1000);
  const slotSeconds = 30 * 60;
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const list = document.createElement("div");
  list.className = "timeline-list";

  for (const target of targets) {
    const isDown = target.status === "down";
    const intervals = incidentIntervals(data, target.key, windowStart, now);
    const card = document.createElement("article");
    card.className = `timeline-card ${isDown ? "is-down" : "is-up"}`;
    card.append(buildHead(target));

    const timeline = document.createElement("div");
    timeline.className = "timeline";
    timeline.setAttribute("aria-label", `Disponibilite 24h ${target.label}`);

    for (let index = 0; index < 48; index += 1) {
      const start = new Date(windowStart.getTime() + index * slotSeconds * 1000);
      const end = new Date(start.getTime() + slotSeconds * 1000);
      const downSeconds = overlapSeconds(intervals, start, end);
      const slot = document.createElement("span");
      slot.className = "slot";
      if (downSeconds >= slotSeconds - 1) {
        slot.classList.add("is-down");
      } else if (downSeconds > 0) {
        slot.classList.add("is-partial");
      }
      slot.title = `${formatDate(start)} - ${formatDate(end)}`;
      timeline.append(slot);
    }

    const detail = document.createElement("p");
    detail.className = "detail";
    if (isDown) {
      const duration = formatDuration(target.current_downtime_seconds);
      detail.textContent = duration
        ? `Incident en cours depuis ${formatDate(target.down_since)} (${duration})`
        : `Incident en cours depuis ${formatDate(target.down_since)}`;
    } else {
      detail.textContent = "Aucun incident en cours.";
    }

    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = `
      <span class="legend-item"><span class="legend-dot"></span>Up</span>
      <span class="legend-item"><span class="legend-dot is-partial"></span>Partiel</span>
      <span class="legend-item"><span class="legend-dot is-down"></span>Down</span>
    `;

    card.append(timeline, detail, legend);
    list.append(card);
  }

  panels["24h"].replaceChildren(list);
}

function createTooltip(intervals) {
  const tooltip = document.createElement("div");
  tooltip.className = "down-tooltip";
  tooltip.hidden = true;

  const title = document.createElement("strong");
  title.textContent = intervals.length ? "Incidents detectes" : "Aucun incident";
  tooltip.append(title);

  if (!intervals.length) {
    return tooltip;
  }

  const list = document.createElement("ul");
  for (const interval of intervals) {
    const duration = formatDuration((interval.end - interval.start) / 1000) || "-";
    const item = document.createElement("li");
    item.textContent = `${formatDate(interval.start)} -> ${formatDate(interval.end)} (${duration})`;
    if (interval.last_error) {
      item.textContent += ` - ${interval.last_error}`;
    }
    list.append(item);
  }
  tooltip.append(list);
  return tooltip;
}

function renderUptime(data, days, panel) {
  const now = parseDate(data.updated_at) || new Date();
  const windowStart = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const windowSeconds = days * 24 * 3600;
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const grid = document.createElement("div");
  grid.className = "uptime-grid";

  for (const target of targets) {
    const isDown = target.status === "down";
    const intervals = incidentIntervals(data, target.key, windowStart, now);
    const downSeconds = Math.min(windowSeconds, overlapSeconds(intervals, windowStart, now));
    const downPct = windowSeconds > 0 ? (downSeconds / windowSeconds) * 100 : 0;
    const upPct = Math.max(0, 100 - downPct);

    const card = document.createElement("article");
    card.className = `uptime-card ${isDown ? "is-down" : "is-up"}`;
    card.append(buildHead(target));

    const row = document.createElement("div");
    row.className = "chart-row";

    const pieWrap = document.createElement("div");
    pieWrap.className = "pie-wrap";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "pie");
    svg.setAttribute("viewBox", "0 0 42 42");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Uptime ${percent(upPct)}`);

    const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    bg.setAttribute("class", "pie-bg");
    bg.setAttribute("cx", "21");
    bg.setAttribute("cy", "21");
    bg.setAttribute("r", "15.9155");

    const down = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    down.setAttribute("class", "pie-down");
    down.setAttribute("cx", "21");
    down.setAttribute("cy", "21");
    down.setAttribute("r", "15.9155");
    down.setAttribute("stroke-dasharray", `${downPct} ${100 - downPct}`);
    down.setAttribute("stroke-dashoffset", "0");

    const tooltip = createTooltip(intervals);
    if (downPct > 0) {
      down.setAttribute("tabindex", "0");
      down.addEventListener("mouseenter", () => { tooltip.hidden = false; });
      down.addEventListener("mouseleave", () => { tooltip.hidden = true; });
      down.addEventListener("focus", () => { tooltip.hidden = false; });
      down.addEventListener("blur", () => { tooltip.hidden = true; });
    } else {
      down.setAttribute("pointer-events", "none");
    }

    svg.append(bg, down);

    const center = document.createElement("div");
    center.className = "pie-center";
    center.textContent = percent(upPct);

    pieWrap.append(svg, center, tooltip);

    const metric = document.createElement("div");
    metric.className = "metric";
    const metricValue = document.createElement("strong");
    metricValue.textContent = percent(upPct);
    const metricDetail = document.createElement("p");
    metricDetail.className = "detail";
    const downText = formatDuration(downSeconds) || "0m";
    metricDetail.textContent = `${downText} de downtime sur ${days}j.`;
    metric.append(metricValue, metricDetail);

    row.append(pieWrap, metric);
    card.append(row);
    grid.append(card);
  }

  panel.replaceChildren(grid);
}

function render(data) {
  latestData = data;
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const hasDown = targets.some((target) => target.status === "down");

  summary.classList.toggle("is-up", !hasDown);
  summary.classList.toggle("is-down", hasDown);
  summaryText.textContent = hasDown ? "Incident en cours" : "Operationnel";
  updatedAt.textContent = formatDate(data.updated_at);
  targetCount.textContent = String(targets.length);
  retentionDays.textContent = `${data.retention_days || 30} jours`;

  render24h(data);
  renderUptime(data, 7, panels["7d"]);
  renderUptime(data, 30, panels["30d"]);
}

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    const view = tab.dataset.view;
    tabs.forEach((item) => item.classList.toggle("is-active", item === tab));
    for (const [name, panel] of Object.entries(panels)) {
      panel.classList.toggle("is-active", name === view);
    }
    if (latestData) {
      render(latestData);
    }
  });
}

async function loadStatus() {
  try {
    const response = await fetch(`status.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    render(await response.json());
  } catch (error) {
    summary.classList.remove("is-up");
    summary.classList.add("is-down");
    summaryText.textContent = "Statut indisponible";
    updatedAt.textContent = "-";
    targetCount.textContent = "-";
    retentionDays.textContent = "-";
    panels["24h"].textContent = "Impossible de charger status.json.";
  }
}

loadStatus();
setInterval(loadStatus, 60000);
