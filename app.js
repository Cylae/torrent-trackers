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

const targetParents = {
  forum: "torr9"
};

const formatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "medium"
});

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
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

function formatTime(value) {
  return timeFormatter.format(value).replace(" h ", ":");
}

function floorToHalfHour(value) {
  const date = new Date(value);
  date.setSeconds(0, 0);
  const minutes = date.getMinutes();
  date.setMinutes(minutes >= 30 ? 30 : 0);
  return date;
}

function statusClass(status) {
  if (status === "down") {
    return "is-down";
  }
  if (status === "degraded") {
    return "is-degraded";
  }
  return "is-up";
}

function statusText(status) {
  if (status === "down") {
    return "Hors ligne";
  }
  if (status === "degraded") {
    return "Degrade";
  }
  return "En ligne";
}

function targetStatus(target) {
  return target.status === "down" ? "down" : "up";
}

function aggregateStatus(target) {
  if (target.status === "down") {
    return "down";
  }
  const children = Array.isArray(target.children) ? target.children : [];
  return children.some((child) => aggregateStatus(child) !== "up") ? "degraded" : "up";
}

function getTargetTree(data) {
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const byKey = new Map();
  const roots = [];

  for (const target of targets) {
    byKey.set(target.key, { ...target, children: [] });
  }

  for (const target of targets) {
    const item = byKey.get(target.key);
    const parentKey = target.parent_key || targetParents[target.key];
    const parent = parentKey ? byKey.get(parentKey) : null;
    if (parent) {
      parent.children.push(item);
    } else {
      roots.push(item);
    }
  }

  return roots;
}

function flattenTargets(targets) {
  return targets.flatMap((target) => [target, ...flattenTargets(target.children || [])]);
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

function buildHead(target, status = targetStatus(target)) {
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
  badgeText.textContent = statusText(status);

  badge.append(dot, badgeText);
  head.append(name, badge);
  return head;
}

function buildSubtargetHead(target) {
  const status = targetStatus(target);
  const head = document.createElement("div");
  head.className = "subtarget-head";

  const name = document.createElement("h3");
  name.textContent = target.label || target.key || "Sous-service";

  const badge = document.createElement("span");
  badge.className = `subtarget-badge ${statusClass(status)}`;
  badge.textContent = statusText(status);

  head.append(name, badge);
  return head;
}

function buildStatusDetail(target) {
  const detail = document.createElement("p");
  detail.className = "detail";
  if (target.status === "down") {
    const duration = formatDuration(target.current_downtime_seconds);
    detail.textContent = duration
      ? `Incident en cours depuis ${formatDate(target.down_since)} (${duration})`
      : `Incident en cours depuis ${formatDate(target.down_since)}`;
  } else {
    detail.textContent = "Aucun incident en cours.";
  }
  return detail;
}

function isTimelineMarker(date) {
  return date.getMinutes() === 0 && date.getHours() % 4 === 0;
}

function buildTimelineScale(windowStart, slotSeconds) {
  const scale = document.createElement("div");
  scale.className = "timeline-scale";
  scale.setAttribute("aria-hidden", "true");

  for (let index = 0; index < 48; index += 1) {
    const start = new Date(windowStart.getTime() + index * slotSeconds * 1000);
    const marker = document.createElement("span");
    marker.className = "timeline-scale-cell";
    if (isTimelineMarker(start)) {
      marker.classList.add("has-marker");
      marker.textContent = formatTime(start);
    }
    scale.append(marker);
  }

  return scale;
}

function buildTimelineLegend() {
  const legend = document.createElement("div");
  legend.className = "timeline-legend";
  legend.innerHTML = `
    <span class="legend-item"><span class="legend-dot"></span>Up</span>
    <span class="legend-item"><span class="legend-dot is-partial"></span>Partiel</span>
    <span class="legend-item"><span class="legend-dot is-down"></span>Down</span>
    <span class="legend-note">1 case = 30 minutes</span>
  `;
  return legend;
}

function buildTimeline(target, data, windowStart, windowEnd, slotSeconds) {
  const intervals = incidentIntervals(data, target.key, windowStart, windowEnd);
  const timeline = document.createElement("div");
  timeline.className = "timeline";
  timeline.setAttribute("aria-label", `Disponibilite 24h ${target.label}`);

  for (let index = 0; index < 48; index += 1) {
    const start = new Date(windowStart.getTime() + index * slotSeconds * 1000);
    const end = new Date(start.getTime() + slotSeconds * 1000);
    const downSeconds = overlapSeconds(intervals, start, end);
    const slot = document.createElement("span");
    slot.className = "slot";
    if (isTimelineMarker(start)) {
      slot.classList.add("has-marker");
    }
    if (downSeconds >= slotSeconds - 1) {
      slot.classList.add("is-down");
    } else if (downSeconds > 0) {
      slot.classList.add("is-partial");
    }
    slot.title = `${formatDate(start)} - ${formatDate(end)}`;
    timeline.append(slot);
  }

  return timeline;
}

function buildTimelineEntry(target, data, windowStart, windowEnd, slotSeconds, isChild = false) {
  const entry = document.createElement("div");
  entry.className = `timeline-entry${isChild ? " is-child" : ""}`;
  if (isChild) {
    entry.append(buildSubtargetHead(target));
  }
  entry.append(
    buildTimeline(target, data, windowStart, windowEnd, slotSeconds),
    buildStatusDetail(target)
  );
  return entry;
}

function appendTimelineChildren(container, target, data, windowStart, windowEnd, slotSeconds) {
  const children = Array.isArray(target.children) ? target.children : [];
  if (!children.length) {
    return;
  }

  const list = document.createElement("div");
  list.className = "subtarget-list";
  for (const child of children) {
    list.append(buildTimelineEntry(child, data, windowStart, windowEnd, slotSeconds, true));
    appendTimelineChildren(list, child, data, windowStart, windowEnd, slotSeconds);
  }
  container.append(list);
}

function render24h(data) {
  const now = parseDate(data.updated_at) || new Date();
  const windowEnd = floorToHalfHour(now);
  const windowStart = new Date(windowEnd.getTime() - 24 * 3600 * 1000);
  const slotSeconds = 30 * 60;
  const targets = getTargetTree(data);
  const list = document.createElement("div");
  list.className = "timeline-list";

  for (const target of targets) {
    const status = aggregateStatus(target);
    const card = document.createElement("article");
    card.className = `timeline-card ${statusClass(status)}`;
    card.append(
      buildHead(target, status),
      buildTimelineEntry(target, data, windowStart, windowEnd, slotSeconds)
    );
    appendTimelineChildren(card, target, data, windowStart, windowEnd, slotSeconds);
    list.append(card);
  }

  const timelineHeader = document.createElement("div");
  timelineHeader.className = "timeline-header";
  timelineHeader.append(buildTimelineLegend(), buildTimelineScale(windowStart, slotSeconds));

  panels["24h"].replaceChildren(timelineHeader, list);
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

function uptimeMetrics(target, data, now, windowStart, windowSeconds) {
  const intervals = incidentIntervals(data, target.key, windowStart, now);
  const downSeconds = Math.min(windowSeconds, overlapSeconds(intervals, windowStart, now));
  const downPct = windowSeconds > 0 ? (downSeconds / windowSeconds) * 100 : 0;
  return {
    downSeconds,
    downPct,
    intervals,
    upPct: Math.max(0, 100 - downPct)
  };
}

function buildUptimeSubtargetEntry(target, data, days, now, windowStart, windowSeconds) {
  const { downSeconds, downPct, intervals, upPct } = uptimeMetrics(
    target,
    data,
    now,
    windowStart,
    windowSeconds
  );
  const entry = document.createElement("div");
  entry.className = "uptime-entry is-child is-compact";

  const row = document.createElement("div");
  row.className = "compact-uptime-row";

  const pieWrap = document.createElement("div");
  pieWrap.className = "mini-pie-wrap";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "pie mini-pie");
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
  pieWrap.append(svg, tooltip);

  const content = document.createElement("div");
  content.className = "compact-uptime-content";
  content.append(buildSubtargetHead(target));

  const facts = document.createElement("div");
  facts.className = "compact-metrics";

  const uptime = document.createElement("span");
  uptime.textContent = `${percent(upPct)} uptime`;

  const downtime = document.createElement("span");
  downtime.textContent = `${formatDuration(downSeconds) || "0m"} down sur ${days}j`;

  facts.append(uptime, downtime);
  content.append(facts);

  row.append(pieWrap, content);
  entry.append(row);
  return entry;
}

function buildUptimeEntry(target, data, days, now, windowStart, windowSeconds) {
  const { downSeconds, downPct, intervals, upPct } = uptimeMetrics(
    target,
    data,
    now,
    windowStart,
    windowSeconds
  );
  const entry = document.createElement("div");
  entry.className = "uptime-entry";

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
  entry.append(row);
  return entry;
}

function buildUptimeChildrenPanel(target, data, days, now, windowStart, windowSeconds) {
  const children = Array.isArray(target.children) ? target.children : [];
  if (!children.length) {
    return null;
  }

  const panel = document.createElement("aside");
  panel.className = "uptime-children-panel";

  const title = document.createElement("div");
  title.className = "uptime-children-title";
  title.textContent = "Sous-services";

  const list = document.createElement("div");
  list.className = "uptime-children-list";
  for (const child of children) {
    list.append(buildUptimeSubtargetEntry(child, data, days, now, windowStart, windowSeconds));
    const nestedPanel = buildUptimeChildrenPanel(child, data, days, now, windowStart, windowSeconds);
    if (nestedPanel) {
      list.append(nestedPanel);
    }
  }

  panel.append(title, list);
  return panel;
}

function renderUptime(data, days, panel) {
  const now = parseDate(data.updated_at) || new Date();
  const windowStart = new Date(now.getTime() - days * 24 * 3600 * 1000);
  const windowSeconds = days * 24 * 3600;
  const targets = getTargetTree(data);
  const grid = document.createElement("div");
  grid.className = "uptime-grid";

  for (const target of targets) {
    const status = aggregateStatus(target);
    const childrenPanel = buildUptimeChildrenPanel(target, data, days, now, windowStart, windowSeconds);
    const body = document.createElement("div");
    body.className = `uptime-card-body${childrenPanel ? " has-children" : ""}`;
    body.append(buildUptimeEntry(target, data, days, now, windowStart, windowSeconds));
    if (childrenPanel) {
      body.append(childrenPanel);
    }

    const card = document.createElement("article");
    card.className = `uptime-card ${statusClass(status)}${childrenPanel ? " has-children" : ""}`;
    card.append(buildHead(target, status), body);
    grid.append(card);
  }

  panel.replaceChildren(grid);
}

function render(data) {
  latestData = data;
  const targetTree = getTargetTree(data);
  const targets = flattenTargets(targetTree);
  const hasDown = targets.some((target) => target.status === "down");

  summary.classList.toggle("is-up", !hasDown);
  summary.classList.toggle("is-down", hasDown);
  summaryText.textContent = hasDown ? "Incident en cours" : "Operationnel";
  updatedAt.textContent = formatDate(data.updated_at);
  targetCount.textContent = String(targetTree.length);
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
