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
const visitorCountMonth = document.querySelector("#visitor-count-month");
const visitorCountTotal = document.querySelector("#visitor-count-total");
const includeUnavailable = document.querySelector("#include-unavailable");

let latestData = null;
let includeUnavailableData = true;
let statusRefreshInFlight = false;

const refreshIntervalMs = 30000;
const dataUnavailableError = "La connectivité réseau locale du conteneur est indisponible.";
const dataUnavailableMessage = "Pour des raisons techniques, le service de monitoring était indisponible.";
const countApiBase = "https://countapi.mileshilliard.com/api/v1";
const visitorCounterKey = "saltedbutch-torrent-trackers-visits";
const visitorCounterDate = new Date();
const visitorMonthCounterKey = `${visitorCounterKey}-${visitorCounterDate.getFullYear()}-${String(visitorCounterDate.getMonth() + 1).padStart(2, "0")}`;

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

function formatInteger(value) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function visitorSessionKey(counterKey) {
  return `countapi-hit:${counterKey}`;
}

function hasSessionHit(counterKey) {
  try {
    return window.sessionStorage.getItem(visitorSessionKey(counterKey)) === "1";
  } catch {
    return false;
  }
}

function markSessionHit(counterKey) {
  try {
    window.sessionStorage.setItem(visitorSessionKey(counterKey), "1");
  } catch {
    // sessionStorage can be disabled; the counter still works without it.
  }
}

async function fetchVisitorCount() {
  const counters = [
    {
      element: visitorCountMonth,
      key: visitorMonthCounterKey,
      label: "Compteur mensuel public CountAPI"
    },
    {
      element: visitorCountTotal,
      key: visitorCounterKey,
      label: "Compteur total public CountAPI"
    }
  ].filter((counter) => counter.element);

  if (!counters.length) {
    return;
  }

  await Promise.all(counters.map(async (counter) => {
    const shouldIncrement = !hasSessionHit(counter.key);
    const endpoint = shouldIncrement ? "hit" : "get";

    try {
      const response = await fetch(`${countApiBase}/${endpoint}/${counter.key}`, {
        cache: "no-store",
        referrerPolicy: "strict-origin-when-cross-origin"
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!Number.isFinite(data.value)) {
        throw new Error("Invalid CountAPI response");
      }
      counter.element.textContent = formatInteger(data.value);
      counter.element.title = counter.label;
      if (shouldIncrement) {
        markSessionHit(counter.key);
      }
    } catch (error) {
      console.warn(`[visits] counter unavailable: ${counter.key}`, error);
      counter.element.textContent = "Indisponible";
      counter.element.title = "Impossible de joindre CountAPI";
    }
  }));
}

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function targetHistoryStart(target, data) {
  return parseDate(target.history_started_at) || parseDate(data.history_started_at);
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
  if (status === "unknown") {
    return "is-unknown";
  }
  if (status === "down") {
    return "is-down";
  }
  if (status === "degraded") {
    return "is-degraded";
  }
  return "is-up";
}

function statusText(status) {
  if (status === "unknown") {
    return "Données indisponibles";
  }
  if (status === "down") {
    return "Hors ligne";
  }
  if (status === "degraded") {
    return "Dégradé";
  }
  return "En ligne";
}

function targetStatus(target) {
  if (target.status === "down" && isDataUnavailableError(target.last_error)) {
    return "unknown";
  }
  return target.status === "down" ? "down" : "up";
}

function isDataUnavailableError(error) {
  return typeof error === "string" && error.includes(dataUnavailableError);
}

function externalServiceStatus(service) {
  if (service.status === "down") {
    return "down";
  }
  if (service.status === "degraded") {
    return "degraded";
  }
  return "up";
}

function externalStatus(entry) {
  const services = Array.isArray(entry.services) ? entry.services : [];
  const statuses = services.map((service) => externalServiceStatus(service));

  if (!statuses.length) {
    return externalServiceStatus(entry);
  }

  if (statuses.every((status) => status === "down")) {
    return "down";
  }
  if (statuses.some((status) => status !== "up")) {
    return "degraded";
  }
  return "up";
}

function externalStatusesForTarget(data, targetKey) {
  const statuses = Array.isArray(data.external_status) ? data.external_status : [];
  return statuses.filter((entry) => entry.target_key === targetKey);
}

function pingClass(pingMs) {
  if (!Number.isFinite(pingMs)) {
    return "";
  }
  if (pingMs <= 100) {
    return "ping-excellent";
  }
  if (pingMs <= 300) {
    return "ping-good";
  }
  if (pingMs <= 800) {
    return "ping-slow";
  }
  return "ping-critical";
}

function uptimeClass(uptimePercent) {
  if (!Number.isFinite(uptimePercent)) {
    return "";
  }
  if (uptimePercent >= 99.9) {
    return "uptime-excellent";
  }
  if (uptimePercent >= 99) {
    return "uptime-good";
  }
  if (uptimePercent >= 95) {
    return "uptime-degraded";
  }
  return "uptime-critical";
}

function formatUptimePercent(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const precision = value >= 99.9 ? 2 : 1;
  return `${value.toFixed(precision).replace(".", ",")} %`;
}

function formatProviderName(provider) {
  if (provider === "uptime-kuma") {
    return "Uptime Kuma";
  }
  return provider || "Status";
}

function officialSiteLabel(entry, target) {
  const rawLabel = entry.label || target.label || target.key || "";
  return rawLabel
    .replace(/^statut\s+officiel\s+/i, "")
    .replace(/^status\s+official\s+/i, "")
    .trim();
}

function pingHistoryPoints(service) {
  const history = Array.isArray(service.ping_history) ? service.ping_history : [];
  return history
    .map((point) => ({
      timestamp: parseDate(point.timestamp),
      status: point.status,
      pingMs: Number.isFinite(point.ping_ms) ? point.ping_ms : null
    }))
    .filter((point) => point.timestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function percentile(values, ratio) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function buildPingSparkline(service) {
  const points = pingHistoryPoints(service);
  if (points.length < 2) {
    return null;
  }

  const validPings = points
    .map((point) => point.pingMs)
    .filter((value) => Number.isFinite(value));
  if (!validPings.length) {
    return null;
  }

  const width = 240;
  const height = 58;
  const padX = 4;
  const padY = 6;
  const minTime = points[0].timestamp.getTime();
  const maxTime = points[points.length - 1].timestamp.getTime();
  const timeRange = Math.max(1, maxTime - minTime);
  const p95 = percentile(validPings, 0.95);
  const maxPing = Math.max(100, Math.min(Math.max(...validPings), Math.max(p95 * 1.35, 300)));

  function xFor(point) {
    return padX + ((point.timestamp.getTime() - minTime) / timeRange) * (width - padX * 2);
  }

  function yFor(pingMs) {
    const clamped = Math.min(maxPing, Math.max(0, pingMs));
    return height - padY - (clamped / maxPing) * (height - padY * 2);
  }

  const segments = [];
  let current = [];
  for (const point of points) {
    if (!Number.isFinite(point.pingMs) || point.status === "down") {
      if (current.length > 1) {
        segments.push(current);
      }
      current = [];
      continue;
    }
    current.push({
      x: xFor(point),
      y: yFor(point.pingMs),
      pingMs: point.pingMs
    });
  }
  if (current.length > 1) {
    segments.push(current);
  }

  const wrap = document.createElement("div");
  wrap.className = "ping-chart";

  const head = document.createElement("div");
  head.className = "ping-chart-head";

  const label = document.createElement("span");
  label.textContent = "Ping history";

  const stats = document.createElement("strong");
  const avg = Math.round(validPings.reduce((sum, value) => sum + value, 0) / validPings.length);
  const latest = validPings.at(-1);
  stats.textContent = `avg ${avg} ms · last ${latest} ms`;
  head.append(label, stats);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ping-sparkline");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Historique ping ${service.label || service.key || "service"}`);

  const guide100 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  guide100.setAttribute("class", "ping-guide ping-guide-good");
  guide100.setAttribute("x1", String(padX));
  guide100.setAttribute("x2", String(width - padX));
  guide100.setAttribute("y1", yFor(100).toFixed(1));
  guide100.setAttribute("y2", yFor(100).toFixed(1));

  const guide300 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  guide300.setAttribute("class", "ping-guide ping-guide-warn");
  guide300.setAttribute("x1", String(padX));
  guide300.setAttribute("x2", String(width - padX));
  guide300.setAttribute("y1", yFor(300).toFixed(1));
  guide300.setAttribute("y2", yFor(300).toFixed(1));

  svg.append(guide100, guide300);

  for (const segment of segments) {
    for (let index = 1; index < segment.length; index += 1) {
      const previous = segment[index - 1];
      const currentPoint = segment[index];
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      const segmentPing = Math.max(previous.pingMs, currentPoint.pingMs);
      line.setAttribute("class", `ping-line ${pingClass(segmentPing)}`);
      line.setAttribute("x1", previous.x.toFixed(1));
      line.setAttribute("y1", previous.y.toFixed(1));
      line.setAttribute("x2", currentPoint.x.toFixed(1));
      line.setAttribute("y2", currentPoint.y.toFixed(1));
      svg.append(line);
    }
  }

  for (const point of points) {
    if (!Number.isFinite(point.pingMs)) {
      continue;
    }
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("class", `ping-point ${pingClass(point.pingMs)}`);
    dot.setAttribute("cx", xFor(point).toFixed(1));
    dot.setAttribute("cy", yFor(point.pingMs).toFixed(1));
    dot.setAttribute("r", point.pingMs > maxPing ? "2.9" : "2.2");
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${formatDate(point.timestamp)} · ${point.pingMs} ms`;
    dot.append(title);
    svg.append(dot);
  }

  wrap.append(head, svg);
  return wrap;
}

function buildPingLegend() {
  const legend = document.createElement("div");
  legend.className = "ping-chart-legend";
  legend.innerHTML = `
    <span><i class="ping-swatch ping-excellent"></i>&le;100ms</span>
    <span><i class="ping-swatch ping-good"></i>&le;300ms</span>
    <span><i class="ping-swatch ping-slow"></i>&le;800ms</span>
    <span><i class="ping-swatch ping-critical"></i>&gt;800ms</span>
  `;
  return legend;
}

function directChildrenStatus(target, includeExternal = true) {
  const children = Array.isArray(target.children) ? target.children : [];
  const externalStatuses = includeExternal
    ? (target.external_status || []).map((entry) => externalStatus(entry))
    : [];
  if (!children.length && !externalStatuses.length) {
    return targetStatus(target);
  }
  const childStatuses = [
    ...children.map((child) => aggregateStatus(child, includeExternal)),
    ...externalStatuses
  ];
  const currentStatus = targetStatus(target);
  if (currentStatus === "unknown" && childStatuses.every((status) => status === "unknown")) {
    return "unknown";
  }
  if (currentStatus === "down" && childStatuses.every((status) => status === "down")) {
    return "down";
  }
  if (childStatuses.some((status) => status !== "up")) {
    return "degraded";
  }
  return currentStatus;
}

function aggregateStatus(target, includeExternal = true) {
  const currentStatus = targetStatus(target);
  if (currentStatus !== "up") {
    return currentStatus;
  }
  const children = Array.isArray(target.children) ? target.children : [];
  const hasChildIssue = children.some((child) => aggregateStatus(child, includeExternal) !== "up");
  const hasExternalIssue = includeExternal
    && (target.external_status || []).some((entry) => externalStatus(entry) !== "up");
  return hasChildIssue || hasExternalIssue ? "degraded" : "up";
}

function getTargetTree(data) {
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const byKey = new Map();
  const roots = [];

  for (const target of targets) {
    byKey.set(target.key, {
      ...target,
      children: [],
      external_status: externalStatusesForTarget(data, target.key)
    });
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
    .filter((incident) => incident.target_key === targetKey && !isDataUnavailableError(incident.last_error))
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

function dataUnavailableIntervals(data, windowStart, windowEnd) {
  const incidents = Array.isArray(data.incidents) ? data.incidents : [];
  const intervals = incidents
    .filter((incident) => isDataUnavailableError(incident.last_error))
    .map((incident) => {
      const startedAt = parseDate(incident.started_at);
      const endedAt = parseDate(incident.ended_at) || windowEnd;
      if (!startedAt || endedAt <= windowStart || startedAt >= windowEnd) {
        return null;
      }
      return {
        ...incident,
        label: "Données indisponibles",
        start: new Date(Math.max(startedAt.getTime(), windowStart.getTime())),
        end: new Date(Math.min(endedAt.getTime(), windowEnd.getTime()))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  return mergeIntervals(intervals);
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = new Date(Math.max(previous.end.getTime(), interval.end.getTime()));
      previous.duration_seconds = Math.max(
        0,
        (previous.end.getTime() - previous.start.getTime()) / 1000
      );
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function overlapSeconds(intervals, start, end) {
  return intervals.reduce((total, interval) => {
    const overlapStart = Math.max(start.getTime(), interval.start.getTime());
    const overlapEnd = Math.min(end.getTime(), interval.end.getTime());
    return total + Math.max(0, overlapEnd - overlapStart) / 1000;
  }, 0);
}

function overlapExcludingSeconds(intervals, excludedIntervals, start, end) {
  return intervals.reduce((total, interval) => {
    const overlapStart = new Date(Math.max(start.getTime(), interval.start.getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), interval.end.getTime()));
    if (overlapEnd <= overlapStart) {
      return total;
    }
    const seconds = (overlapEnd.getTime() - overlapStart.getTime()) / 1000;
    const excludedSeconds = overlapSeconds(excludedIntervals, overlapStart, overlapEnd);
    return total + Math.max(0, seconds - excludedSeconds);
  }, 0);
}

function overlappingIntervals(intervals, start, end) {
  return intervals.filter((interval) => {
    const overlapStart = Math.max(start.getTime(), interval.start.getTime());
    const overlapEnd = Math.min(end.getTime(), interval.end.getTime());
    return overlapEnd > overlapStart;
  });
}

function buildHead(target, status = targetStatus(target)) {
  const head = document.createElement("div");
  head.className = "status-head";

  const name = document.createElement("h2");
  name.className = "status-name";
  name.textContent = target.label || target.key || "Tracker";

  const badge = document.createElement("span");
  badge.className = `badge ${statusClass(status)}`;

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
  const status = targetStatus(target);
  if (status === "unknown") {
    detail.textContent = dataUnavailableMessage;
  } else if (status === "down") {
    const duration = formatDuration(target.current_downtime_seconds);
    detail.textContent = duration
      ? `Incident en cours depuis ${formatDate(target.down_since)} (${duration})`
      : `Incident en cours depuis ${formatDate(target.down_since)}`;
  } else {
    detail.textContent = "Aucun incident en cours.";
  }
  return detail;
}

function buildExternalStatusPanel(target) {
  const entries = Array.isArray(target.external_status) ? target.external_status : [];
  if (!entries.length) {
    return null;
  }

  const panel = document.createElement("section");
  panel.className = "official-status-panel";

  for (const entry of entries) {
    const title = document.createElement(entry.status_url ? "a" : "div");
    title.className = "official-source-link";
    title.textContent = `${formatProviderName(entry.provider)} Officiel ${officialSiteLabel(entry, target)}`;
    if (entry.status_url) {
      title.href = entry.status_url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    panel.append(title);

    const services = Array.isArray(entry.services) ? entry.services : [];
    if (services.length) {
      const list = document.createElement("div");
      list.className = "official-service-list";
      if (entry.status_url) {
        list.dataset.statusUrl = entry.status_url;
      }
      let hasPingCharts = false;

      for (const service of services) {
        const serviceStatus = externalServiceStatus(service);
        const hasCurrentPing = Number.isFinite(service.ping_ms);
        const item = document.createElement("div");
        item.className = `official-service ${statusClass(serviceStatus)}`;

        const serviceLabel = document.createElement("span");
        serviceLabel.textContent = service.label || service.key || "Service";

        const serviceMeta = document.createElement("strong");
        serviceMeta.textContent = hasCurrentPing
          ? `${statusText(serviceStatus)} · ${service.ping_ms} ms`
          : `${statusText(serviceStatus)} · ping indisponible`;

        const uptimeText = formatUptimePercent(service.uptime_24h_percent);
        if (uptimeText) {
          const uptime = document.createElement("em");
          uptime.className = `official-uptime ${uptimeClass(service.uptime_24h_percent)}`;
          uptime.textContent = `Uptime 24h ${uptimeText}`;
          item.append(serviceLabel, serviceMeta, uptime);
        } else {
          item.append(serviceLabel, serviceMeta);
        }
        const servicePingClass = pingClass(service.ping_ms);
        if (servicePingClass) {
          item.classList.add(servicePingClass);
        }
        if (!hasCurrentPing) {
          item.classList.add("has-no-ping");
        }
        const chart = buildPingSparkline(service);
        if (chart) {
          item.append(chart);
          hasPingCharts = true;
        } else if (!hasCurrentPing) {
          const unavailable = document.createElement("div");
          unavailable.className = "ping-unavailable";
          unavailable.textContent = "Aucune mesure de ping disponible";
          item.append(unavailable);
        }
        list.append(item);
      }

      let legend = null;
      if (hasPingCharts) {
        const toggle = document.createElement("button");
        toggle.className = "official-graph-toggle";
        toggle.type = "button";
        toggle.setAttribute("aria-expanded", "true");
        toggle.textContent = "Masquer les graphes";
        legend = buildPingLegend();
        toggle.addEventListener("click", () => {
          const collapsed = list.classList.toggle("are-graphs-collapsed");
          if (legend) {
            legend.hidden = collapsed;
          }
          toggle.setAttribute("aria-expanded", String(!collapsed));
          toggle.textContent = collapsed ? "Afficher les graphes" : "Masquer les graphes";
        });
        panel.append(toggle);
      }

      panel.append(list);
      if (legend) {
        panel.append(legend);
      }
    }
  }

  if (!panel.childElementCount) {
    return null;
  }
  return panel;
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
    <span class="legend-item"><span class="legend-dot is-unknown"></span>Données indisponibles</span>
    <span class="legend-note">1 case = 30 minutes</span>
  `;
  return legend;
}

function buildTimeline(target, data, windowStart, windowEnd, slotSeconds) {
  const intervals = incidentIntervals(data, target.key, windowStart, windowEnd)
    .map((interval, index) => ({ ...interval, periodId: `down-${index}` }));
  const unavailableIntervals = dataUnavailableIntervals(data, windowStart, windowEnd)
    .map((interval, index) => ({ ...interval, periodId: `unknown-${index}` }));
  const timeline = document.createElement("div");
  timeline.className = "timeline";
  timeline.setAttribute("aria-label", `Disponibilité 24h ${target.label}`);

  for (let index = 0; index < 48; index += 1) {
    const start = new Date(windowStart.getTime() + index * slotSeconds * 1000);
    const end = new Date(start.getTime() + slotSeconds * 1000);
    const downSeconds = overlapSeconds(intervals, start, end);
    const unavailableSeconds = overlapSeconds(unavailableIntervals, start, end);
    const slotUnavailableIntervals = overlappingIntervals(unavailableIntervals, start, end);
    const slotIncidentIntervals = overlappingIntervals(intervals, start, end);
    const highlightedIntervals = slotUnavailableIntervals.length
      ? slotUnavailableIntervals
      : slotIncidentIntervals;
    const periodIds = highlightedIntervals.map((interval) => interval.periodId);
    const slot = document.createElement("span");
    slot.className = "slot";
    if (isTimelineMarker(start)) {
      slot.classList.add("has-marker");
    }
    if (unavailableSeconds >= slotSeconds - 1) {
      slot.classList.add("is-unknown");
    } else if (downSeconds >= slotSeconds - 1) {
      slot.classList.add("is-down");
    } else if (downSeconds > 0 || unavailableSeconds > 0) {
      slot.classList.add("is-partial");
    }

    const slotLabel = `${formatDate(start)} -> ${formatDate(end)}`;
    if (downSeconds > 0 || unavailableSeconds > 0) {
      const tooltip = unavailableSeconds > 0
        ? createUnavailableTooltip(
          start,
          end,
          unavailableSeconds,
          slotUnavailableIntervals
        )
        : createTooltip(slotIncidentIntervals);
      slot.setAttribute("tabindex", "0");
      slot.dataset.periodIds = periodIds.join(" ");
      slot.addEventListener("mouseenter", () => {
        tooltip.hidden = false;
        highlightTimelinePeriods(timeline, periodIds);
      });
      slot.addEventListener("mouseleave", () => {
        tooltip.hidden = true;
        clearTimelineHighlights(timeline);
      });
      slot.addEventListener("focus", () => {
        tooltip.hidden = false;
        highlightTimelinePeriods(timeline, periodIds);
      });
      slot.addEventListener("blur", () => {
        tooltip.hidden = true;
        clearTimelineHighlights(timeline);
      });
      slot.append(tooltip);
    }

    slot.setAttribute("aria-label", slotLabel);
    timeline.append(slot);
  }

  return timeline;
}

function highlightTimelinePeriods(timeline, periodIds) {
  const activeIds = new Set(periodIds);
  if (!activeIds.size) {
    return;
  }

  timeline.classList.add("is-highlighting");
  for (const slot of timeline.querySelectorAll(".slot")) {
    const slotIds = (slot.dataset.periodIds || "").split(" ").filter(Boolean);
    const isHighlighted = slotIds.some((periodId) => activeIds.has(periodId));
    slot.classList.toggle("is-period-highlight", isHighlighted);
  }
}

function clearTimelineHighlights(timeline) {
  timeline.classList.remove("is-highlighting");
  for (const slot of timeline.querySelectorAll(".slot.is-period-highlight")) {
    slot.classList.remove("is-period-highlight");
  }
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
    const status = directChildrenStatus(target);
    const card = document.createElement("article");
    card.className = `timeline-card ${statusClass(status)}`;
    card.append(
      buildHead(target),
      buildTimelineEntry(target, data, windowStart, windowEnd, slotSeconds)
    );
    appendTimelineChildren(card, target, data, windowStart, windowEnd, slotSeconds);
    const externalPanel = buildExternalStatusPanel(target);
    if (externalPanel) {
      card.append(externalPanel);
    }
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
  title.textContent = intervals.length ? "Incidents détectés" : "Aucun incident";
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

function showTooltip(tooltip) {
  tooltip.hidden = false;
}

function hideTooltip(tooltip) {
  tooltip.hidden = true;
}

function bindHoverTooltip(trigger, tooltip) {
  let hideTimer = null;
  const show = () => {
    window.clearTimeout(hideTimer);
    showTooltip(tooltip);
  };
  const hide = () => {
    hideTimer = window.setTimeout(() => hideTooltip(tooltip), 120);
  };

  trigger.addEventListener("mouseenter", show);
  trigger.addEventListener("mouseleave", hide);
  trigger.addEventListener("focus", show);
  trigger.addEventListener("blur", hide);
  tooltip.addEventListener("mouseenter", show);
  tooltip.addEventListener("mouseleave", hide);
}

function createUnavailableTooltip(start, end, seconds, intervals = []) {
  const tooltip = document.createElement("div");
  tooltip.className = "down-tooltip";
  tooltip.hidden = true;

  const title = document.createElement("strong");
  title.textContent = "Données indisponibles";

  tooltip.append(title);

  const message = document.createElement("p");
  message.textContent = dataUnavailableMessage;
  tooltip.append(message);

  if (intervals.length) {
    const list = document.createElement("ul");
    for (const interval of intervals) {
      const item = document.createElement("li");
      const duration = Math.max(0, (interval.end.getTime() - interval.start.getTime()) / 1000);
      item.textContent = `${formatDate(interval.start)} -> ${formatDate(interval.end)} (${formatDuration(duration) || "0m"})`;
      list.append(item);
    }
    tooltip.append(list);
  } else {
    const detail = document.createElement("p");
    detail.textContent = `${formatDate(start)} -> ${formatDate(end)} (${formatDuration(seconds) || "0m"})`;
    tooltip.append(detail);
  }

  return tooltip;
}

function summaryForMode(metrics, days, mode, compact = false) {
  const upText = formatDuration(metrics.upSeconds) || "0m";
  const downText = formatDuration(metrics.downSeconds) || "0m";
  const unavailableText = formatDuration(metrics.unknownSeconds) || "0m";
  const periodText = metrics.includeUnavailable
    ? `${days}j`
    : `${formatDuration(metrics.knownSeconds) || "0m"} de données`;
  const unavailableSuffix = metrics.includeUnavailable
    ? `, ${unavailableText} sans données`
    : "";

  if (mode === "down") {
    return {
      value: percent(metrics.downPct),
      detail: compact
        ? `${downText} down${unavailableSuffix} sur ${periodText}`
        : `${downText} de downtime${unavailableSuffix} sur ${periodText}.`
    };
  }

  if (mode === "unknown") {
    return {
      value: percent(metrics.unknownPct),
      detail: compact
        ? `${unavailableText} sans données sur ${periodText}`
        : `${unavailableText} sans données sur ${periodText}.`
    };
  }

  return {
    value: percent(metrics.upPct),
    detail: compact
      ? `${upText} up${unavailableSuffix} sur ${periodText}`
      : `${upText} d’uptime${unavailableSuffix} sur ${periodText}.`
  };
}

function bindPieSegmentSelection(segments, setSummary) {
  function select(segment) {
    for (const item of segments) {
      item.element.classList.toggle("is-selected", item === segment);
    }
    setSummary(segment.mode);
  }

  for (const segment of segments) {
    if (!segment.enabled) {
      segment.element.setAttribute("pointer-events", "none");
      continue;
    }

    segment.element.setAttribute("tabindex", "0");
    segment.element.setAttribute("role", "button");
    segment.element.setAttribute("aria-label", segment.label);
    segment.element.addEventListener("click", () => select(segment));
    segment.element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(segment);
      }
    });
  }

  const initialSegment = segments.find((segment) => segment.mode === "up" && segment.enabled)
    || segments.find((segment) => segment.enabled);
  if (initialSegment) {
    select(initialSegment);
  }
}

function uptimeMetrics(target, data, now, windowStart, windowSeconds) {
  const historyStart = targetHistoryStart(target, data);
  const knownStart = historyStart && historyStart > windowStart ? historyStart : windowStart;
  const unknownEnd = new Date(Math.min(knownStart.getTime(), now.getTime()));
  const rawUnknownSeconds = Math.min(
    windowSeconds,
    Math.max(0, (unknownEnd.getTime() - windowStart.getTime()) / 1000)
  );
  const prehistoryIntervals = rawUnknownSeconds > 0
    ? incidentIntervals(data, target.key, windowStart, unknownEnd)
    : [];
  const knownPrehistoryDownSeconds = Math.min(
    rawUnknownSeconds,
    overlapSeconds(prehistoryIntervals, windowStart, unknownEnd)
  );
  const prehistoryUnavailableSeconds = Math.max(0, rawUnknownSeconds - knownPrehistoryDownSeconds);
  const prehistoryUnavailableIntervals = prehistoryUnavailableSeconds > 0
    ? [{
      label: "Données indisponibles",
      start: windowStart,
      end: unknownEnd,
      duration_seconds: prehistoryUnavailableSeconds
    }]
    : [];
  const unavailableIntervals = mergeIntervals([
    ...prehistoryUnavailableIntervals,
    ...dataUnavailableIntervals(data, windowStart, now)
  ]);
  const unavailableSeconds = Math.min(
    windowSeconds,
    overlapSeconds(unavailableIntervals, windowStart, now)
  );
  const unknownSeconds = includeUnavailableData ? unavailableSeconds : 0;
  const knownSeconds = Math.max(0, windowSeconds - unavailableSeconds);
  const measuredStart = includeUnavailableData ? knownStart : windowStart;
  const intervals = incidentIntervals(data, target.key, measuredStart, now);
  const excludedIntervals = includeUnavailableData ? unavailableIntervals : [];
  const measuredDownSeconds = overlapExcludingSeconds(intervals, excludedIntervals, measuredStart, now);
  const downSeconds = Math.min(
    knownSeconds,
    (includeUnavailableData ? knownPrehistoryDownSeconds : 0) + measuredDownSeconds
  );
  const denominatorSeconds = includeUnavailableData ? windowSeconds : Math.max(knownSeconds, 1);
  const downPct = denominatorSeconds > 0 ? (downSeconds / denominatorSeconds) * 100 : 0;
  const unknownPct = includeUnavailableData && windowSeconds > 0 ? (unknownSeconds / windowSeconds) * 100 : 0;
  const upSeconds = Math.max(0, knownSeconds - downSeconds);
  const upPct = denominatorSeconds > 0 ? (upSeconds / denominatorSeconds) * 100 : 0;
  const firstUnavailable = unavailableIntervals[0];
  const lastUnavailable = unavailableIntervals[unavailableIntervals.length - 1];
  return {
    downSeconds,
    downPct,
    includeUnavailable: includeUnavailableData,
    intervals,
    knownSeconds,
    unknownEnd: lastUnavailable ? lastUnavailable.end : unknownEnd,
    unknownIntervals: unavailableIntervals,
    unknownSeconds,
    unknownStart: firstUnavailable ? firstUnavailable.start : windowStart,
    unknownPct,
    upSeconds,
    upPct
  };
}

function buildUptimeSubtargetEntry(target, data, days, now, windowStart, windowSeconds) {
  const metrics = uptimeMetrics(
    target,
    data,
    now,
    windowStart,
    windowSeconds
  );
  const { downPct, intervals, unknownEnd, unknownIntervals, unknownPct, unknownSeconds, unknownStart, upPct } = metrics;
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
  bg.setAttribute("stroke-dasharray", "100 0");

  const up = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  up.setAttribute("class", "pie-up");
  up.setAttribute("cx", "21");
  up.setAttribute("cy", "21");
  up.setAttribute("r", "15.9155");
  up.setAttribute("stroke-dasharray", `${upPct} ${100 - upPct}`);
  up.setAttribute("stroke-dashoffset", `${-(unknownPct + downPct)}`);

  const unknown = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  unknown.setAttribute("class", "pie-unknown");
  unknown.setAttribute("cx", "21");
  unknown.setAttribute("cy", "21");
  unknown.setAttribute("r", "15.9155");
  unknown.setAttribute("stroke-dasharray", `${unknownPct} ${100 - unknownPct}`);
  unknown.setAttribute("stroke-dashoffset", "0");

  const unavailableTooltip = createUnavailableTooltip(unknownStart, unknownEnd, unknownSeconds, unknownIntervals);
  if (unknownPct > 0) {
    bindHoverTooltip(unknown, unavailableTooltip);
  }

  const down = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  down.setAttribute("class", "pie-down");
  down.setAttribute("cx", "21");
  down.setAttribute("cy", "21");
  down.setAttribute("r", "15.9155");
  down.setAttribute("stroke-dasharray", `${downPct} ${100 - downPct}`);
  down.setAttribute("stroke-dashoffset", `${-unknownPct}`);

  const tooltip = createTooltip(intervals);
  if (downPct > 0) {
    bindHoverTooltip(down, tooltip);
  }

  svg.append(bg, unknown, down, up);
  pieWrap.append(svg, unavailableTooltip, tooltip);

  const content = document.createElement("div");
  content.className = "compact-uptime-content";
  content.append(buildSubtargetHead(target));

  const facts = document.createElement("div");
  facts.className = "compact-metrics";

  const uptime = document.createElement("span");
  const downtime = document.createElement("span");

  facts.append(uptime, downtime);
  content.append(facts);

  const setSummary = (mode) => {
    const summary = summaryForMode(metrics, days, mode, true);
    uptime.textContent = mode === "up" ? `${summary.value} uptime` : summary.value;
    downtime.textContent = summary.detail;
  };
  bindPieSegmentSelection([
    { element: up, enabled: upPct > 0, label: "Focus uptime", mode: "up" },
    { element: down, enabled: downPct > 0, label: "Focus downtime", mode: "down" },
    { element: unknown, enabled: unknownPct > 0, label: "Focus données indisponibles", mode: "unknown" }
  ], setSummary);

  row.append(pieWrap, content);
  entry.append(row);
  return entry;
}

function buildUptimeEntry(target, data, days, now, windowStart, windowSeconds) {
  const metrics = uptimeMetrics(
    target,
    data,
    now,
    windowStart,
    windowSeconds
  );
  const { downPct, intervals, unknownEnd, unknownIntervals, unknownPct, unknownSeconds, unknownStart, upPct } = metrics;
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
  bg.setAttribute("stroke-dasharray", "100 0");

  const up = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  up.setAttribute("class", "pie-up");
  up.setAttribute("cx", "21");
  up.setAttribute("cy", "21");
  up.setAttribute("r", "15.9155");
  up.setAttribute("stroke-dasharray", `${upPct} ${100 - upPct}`);
  up.setAttribute("stroke-dashoffset", `${-(unknownPct + downPct)}`);

  const unknown = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  unknown.setAttribute("class", "pie-unknown");
  unknown.setAttribute("cx", "21");
  unknown.setAttribute("cy", "21");
  unknown.setAttribute("r", "15.9155");
  unknown.setAttribute("stroke-dasharray", `${unknownPct} ${100 - unknownPct}`);
  unknown.setAttribute("stroke-dashoffset", "0");

  const unavailableTooltip = createUnavailableTooltip(unknownStart, unknownEnd, unknownSeconds, unknownIntervals);
  if (unknownPct > 0) {
    bindHoverTooltip(unknown, unavailableTooltip);
  }

  const down = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  down.setAttribute("class", "pie-down");
  down.setAttribute("cx", "21");
  down.setAttribute("cy", "21");
  down.setAttribute("r", "15.9155");
  down.setAttribute("stroke-dasharray", `${downPct} ${100 - downPct}`);
  down.setAttribute("stroke-dashoffset", `${-unknownPct}`);

  const tooltip = createTooltip(intervals);
  if (downPct > 0) {
    bindHoverTooltip(down, tooltip);
  }

  svg.append(bg, unknown, down, up);

  const center = document.createElement("div");
  center.className = "pie-center";
  center.textContent = percent(upPct);

  pieWrap.append(svg, center, unavailableTooltip, tooltip);

  const metric = document.createElement("div");
  metric.className = "metric";
  const metricValue = document.createElement("strong");
  const metricDetail = document.createElement("p");
  metricDetail.className = "detail";
  metric.append(metricValue, metricDetail);

  const setSummary = (mode) => {
    const summary = summaryForMode(metrics, days, mode);
    metricValue.textContent = summary.value;
    metricDetail.textContent = summary.detail;
    center.textContent = summary.value;
  };
  bindPieSegmentSelection([
    { element: up, enabled: upPct > 0, label: "Focus uptime", mode: "up" },
    { element: down, enabled: downPct > 0, label: "Focus downtime", mode: "down" },
    { element: unknown, enabled: unknownPct > 0, label: "Focus données indisponibles", mode: "unknown" }
  ], setSummary);

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
    const status = directChildrenStatus(target, false);
    const childrenPanel = buildUptimeChildrenPanel(target, data, days, now, windowStart, windowSeconds);
    const body = document.createElement("div");
    body.className = `uptime-card-body${childrenPanel ? " has-children" : ""}`;
    body.append(buildUptimeEntry(target, data, days, now, windowStart, windowSeconds));
    if (childrenPanel) {
      body.append(childrenPanel);
    }

    const card = document.createElement("article");
    card.className = `uptime-card ${statusClass(status)}${childrenPanel ? " has-children" : ""}`;
    card.append(buildHead(target), body);
    grid.append(card);
  }

  panel.replaceChildren(grid);
}

function render(data) {
  latestData = data;
  const targetTree = getTargetTree(data);
  const targets = flattenTargets(targetTree);
  const statuses = targets.map((target) => targetStatus(target));
  const hasDown = statuses.some((status) => status === "down");
  const hasUnknown = statuses.some((status) => status === "unknown");

  summary.classList.toggle("is-up", !hasDown && !hasUnknown);
  summary.classList.toggle("is-down", hasDown);
  summary.classList.toggle("is-unknown", !hasDown && hasUnknown);
  summaryText.textContent = hasDown
    ? "Incident en cours"
    : hasUnknown
      ? "Données indisponibles"
      : "Opérationnel";
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

if (includeUnavailable) {
  includeUnavailable.addEventListener("change", () => {
    includeUnavailableData = includeUnavailable.checked;
    if (latestData) {
      render(latestData);
    }
  });
}

async function loadStatus() {
  if (statusRefreshInFlight) {
    console.debug("[status] refresh skipped: request already in flight");
    return;
  }

  statusRefreshInFlight = true;
  const url = `status.json?ts=${Date.now()}`;
  let step = "fetch";
  try {
    console.debug("[status] fetching", url);
    const response = await fetch(url, { cache: "no-store" });
    console.debug("[status] response", {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type"),
      url: response.url
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    step = "json";
    const rawBody = await response.text();
    console.debug("[status] body received", {
      bytes: rawBody.length,
      preview: rawBody.slice(0, 160)
    });

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      console.error("[status] invalid JSON", {
        error,
        preview: rawBody.slice(0, 500)
      });
      throw error;
    }

    step = "render";
    console.debug("[status] parsed", {
      schemaVersion: data.schema_version,
      updatedAt: data.updated_at,
      targets: Array.isArray(data.targets) ? data.targets.length : "invalid",
      incidents: Array.isArray(data.incidents) ? data.incidents.length : "invalid",
      externalStatus: Array.isArray(data.external_status) ? data.external_status.length : "invalid"
    });
    render(data);
    console.debug("[status] render complete");
  } catch (error) {
    console.error(`[status] failed during ${step}`, error);
    summary.classList.remove("is-up");
    summary.classList.remove("is-unknown");
    summary.classList.add("is-down");
    summaryText.textContent = "Statut indisponible";
    updatedAt.textContent = "-";
    targetCount.textContent = "-";
    retentionDays.textContent = "-";
    panels["24h"].textContent = `Impossible de charger status.json. Étape: ${step}. ${error.message || error}`;
  } finally {
    statusRefreshInFlight = false;
  }
}

loadStatus();
fetchVisitorCount();
setInterval(() => {
  if (!document.hidden) {
    loadStatus();
  }
}, refreshIntervalMs);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    loadStatus();
  }
});

window.addEventListener("focus", loadStatus);
