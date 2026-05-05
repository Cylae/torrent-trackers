const statusGrid = document.querySelector("#status-grid");
const summary = document.querySelector("#summary");
const summaryText = document.querySelector("#summary-text");
const updatedAt = document.querySelector("#updated-at");
const targetCount = document.querySelector("#target-count");

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

function render(data) {
  const targets = Array.isArray(data.targets) ? data.targets : [];
  const hasDown = targets.some((target) => target.status === "down");

  summary.classList.toggle("is-up", !hasDown);
  summary.classList.toggle("is-down", hasDown);
  summaryText.textContent = hasDown ? "Incident en cours" : "Operationnel";
  updatedAt.textContent = formatDate(data.updated_at);
  targetCount.textContent = String(targets.length);

  statusGrid.replaceChildren(...targets.map((target) => {
    const isDown = target.status === "down";
    const card = document.createElement("article");
    card.className = `status-card ${isDown ? "is-down" : "is-up"}`;

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

    const detail = document.createElement("p");
    detail.className = "detail";
    if (isDown) {
      const duration = formatDuration(target.current_downtime_seconds);
      detail.textContent = duration
        ? `Depuis ${formatDate(target.down_since)} (${duration})`
        : `Depuis ${formatDate(target.down_since)}`;
    } else {
      detail.textContent = "Dernier controle OK.";
    }

    card.append(head, detail);

    if (isDown && target.last_error) {
      const error = document.createElement("p");
      error.className = "error";
      error.textContent = target.last_error;
      card.append(error);
    }

    return card;
  }));
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
    statusGrid.textContent = "Impossible de charger status.json.";
  }
}

loadStatus();
setInterval(loadStatus, 60000);
