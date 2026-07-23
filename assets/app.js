"use strict";

const STATION = "RE81D";
const SNAPSHOT_URL = `data/snapshot_${STATION}.json`;
const HISTORY_URL = `data/history_${STATION}.json`;
const POLL_MS = 60_000;
// GitHub Pages' CDN caches data/*.json for up to 10 min (Cache-Control:
// max-age=600) on top of the 5-min push interval, so up to ~15 min of
// normal lag is expected — only flag staleness well past that.
const STALE_AFTER_S = 20 * 60;

const LEVEL_NAMES = {
  0: "0級", 1: "1級", 2: "2級", 3: "3級", 4: "4級",
  5: "5弱", 6: "5強", 7: "6弱", 8: "6強", 9: "7級",
};

function tierFor(level) {
  if (level <= 1) return { tier: "good", label: "輕微" };
  if (level <= 3) return { tier: "warning", label: "有感" };
  if (level <= 5) return { tier: "serious", label: "強烈" };
  return { tier: "critical", label: "劇烈" };
}

function relTime(iso) {
  const t = new Date(iso).getTime();
  const diffS = Math.max(0, (Date.now() - t) / 1000);
  if (diffS < 5) return "剛剛";
  if (diffS < 60) return `${Math.floor(diffS)} 秒前`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)} 分鐘前`;
  return `${Math.floor(diffS / 3600)} 小時前`;
}

function clockTime(t) {
  return new Date(t).toLocaleTimeString("zh-TW", { hour12: false, timeZone: "Asia/Taipei" });
}

function fmt(n, digits) {
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

async function fetchJSON(url) {
  const res = await fetch(`${url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- charts --

const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function clientToFrac(evt, svg) {
  const rect = svg.getBoundingClientRect();
  const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

function nearestIndex(points, t) {
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].t - t) < Math.abs(points[lo].t - t)) return lo - 1;
  return lo;
}

/**
 * Renders a single-series line chart (no legend — one series needs none).
 * points: [{t: epochMillis, v: number}], sorted ascending by t.
 */
function renderLineChart(svg, tooltip, points, opts) {
  const {
    unit = "", yFmt = (v) => fmt(v, 2), xFmt = clockTime,
    symmetric = false, emptyMessage = "尚無資料",
  } = opts;

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const vb = svg.viewBox.baseVal;
  const W = vb.width, H = vb.height;
  const m = { l: 40, r: 10, t: 10, b: 20 };
  const innerW = W - m.l - m.r, innerH = H - m.t - m.b;

  if (!points || points.length < 2) {
    svg.appendChild(el("text", {
      x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis-label",
    })).textContent = emptyMessage;
    tooltip.hidden = true;
    return;
  }

  const tMin = points[0].t, tMax = points[points.length - 1].t;
  let vMin, vMax;
  if (symmetric) {
    const peak = Math.max(1e-6, ...points.map((p) => Math.abs(p.v))) * 1.15;
    vMin = -peak; vMax = peak;
  } else {
    vMax = Math.max(1e-6, ...points.map((p) => p.v)) * 1.15;
    vMin = 0;
  }

  const sx = (t) => m.l + ((t - tMin) / (tMax - tMin || 1)) * innerW;
  const sy = (v) => m.t + innerH - ((v - vMin) / (vMax - vMin || 1)) * innerH;

  // gridlines + y labels
  for (const frac of [0, 0.5, 1]) {
    const val = vMin + frac * (vMax - vMin);
    const y = sy(val);
    svg.appendChild(el("line", {
      x1: m.l, x2: W - m.r, y1: y, y2: y, class: "grid-line",
    }));
    const label = el("text", { x: m.l - 6, y: y + 3, "text-anchor": "end", class: "axis-label" });
    label.textContent = yFmt(val);
    svg.appendChild(label);
  }
  if (symmetric) {
    const y0 = sy(0);
    svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: y0, y2: y0, class: "baseline" }));
  }

  // x labels (start / mid / end)
  for (const frac of [0, 0.5, 1]) {
    const t = tMin + frac * (tMax - tMin);
    const anchor = frac === 0 ? "start" : frac === 1 ? "end" : "middle";
    const label = el("text", { x: sx(t), y: H - 4, "text-anchor": anchor, class: "axis-label" });
    label.textContent = xFmt(t);
    svg.appendChild(label);
  }

  // area wash (only for non-symmetric magnitude series, anchored to baseline 0)
  if (!symmetric) {
    const areaD = [`M ${sx(tMin)} ${sy(0)}`]
      .concat(points.map((p) => `L ${sx(p.t)} ${sy(p.v)}`))
      .concat([`L ${sx(tMax)} ${sy(0)} Z`])
      .join(" ");
    svg.appendChild(el("path", { d: areaD, class: "series-area" }));
  }

  const lineD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.t)} ${sy(p.v)}`).join(" ");
  svg.appendChild(el("path", { d: lineD, class: "series-line" }));

  const crosshair = el("line", { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: "crosshair" });
  const dot = el("circle", { r: 4, class: "hover-dot" });
  svg.appendChild(crosshair);
  svg.appendChild(dot);

  const hit = el("rect", {
    x: m.l, y: m.t, width: innerW, height: innerH, class: "hit-layer",
  });
  svg.appendChild(hit);

  const container = svg.parentElement;
  function show(evt) {
    const frac = clientToFrac(evt, svg);
    const t = tMin + frac * (tMax - tMin);
    const p = points[nearestIndex(points, t)];
    const x = sx(p.t), y = sy(p.v);
    crosshair.setAttribute("x1", x);
    crosshair.setAttribute("x2", x);
    crosshair.style.opacity = 1;
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    dot.style.opacity = 1;

    const rect = svg.getBoundingClientRect();
    const px = rect.width * (x / W);
    const py = rect.height * (y / H);
    tooltip.hidden = false;
    tooltip.style.left = `${px}px`;
    tooltip.style.top = `${py}px`;
    tooltip.innerHTML =
      `<div class="tt-value">${yFmt(p.v)} ${unit}</div><div class="tt-time">${xFmt(p.t, true)}</div>`;
  }
  function hide() {
    crosshair.style.opacity = 0;
    dot.style.opacity = 0;
    tooltip.hidden = true;
  }
  hit.addEventListener("pointermove", show);
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("pointerdown", show);
}

function renderSparkline(svg, values) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!values || values.length < 2) return;
  const vb = svg.viewBox.baseVal;
  const W = vb.width, H = vb.height, pad = 3;
  const vMin = Math.min(...values), vMax = Math.max(...values);
  const sx = (i) => pad + (i / (values.length - 1)) * (W - 2 * pad);
  const sy = (v) => H - pad - ((v - vMin) / (vMax - vMin || 1)) * (H - 2 * pad);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"} ${sx(i)} ${sy(v)}`).join(" ");
  svg.appendChild(el("path", { d, class: "spark-line" }));
  const last = values.length - 1;
  svg.appendChild(el("circle", {
    cx: sx(last), cy: sy(values[last]), r: 2.5, class: "spark-dot",
  }));
}

// ------------------------------------------------------------------ main --

async function render() {
  let snapshot, history;
  try {
    [snapshot, history] = await Promise.all([
      fetchJSON(SNAPSHOT_URL),
      fetchJSON(HISTORY_URL),
    ]);
  } catch (e) {
    document.getElementById("station-line").textContent = "無法載入資料";
    console.error(e);
    return;
  }

  document.getElementById("station-line").textContent =
    `${snapshot.station}.${snapshot.network} · ${snapshot.location_label}`;

  const ageS = (Date.now() - new Date(snapshot.generated_at).getTime()) / 1000;
  const staleBanner = document.getElementById("stale-banner");
  if (ageS > STALE_AFTER_S) {
    staleBanner.hidden = false;
    document.getElementById("stale-text").textContent =
      `資料已 ${Math.floor(ageS / 60)} 分鐘未更新，可能是測站或同步流程中斷 — 以下數值非目前即時狀態`;
  } else {
    staleBanner.hidden = true;
  }

  const cur = snapshot.current;
  const { tier, label } = tierFor(cur.intensity_level);
  document.getElementById("tile-intensity").textContent = LEVEL_NAMES[cur.intensity_level] ?? "—";
  const badge = document.getElementById("tile-intensity-badge");
  badge.innerHTML = `<span class="status-dot status-${tier}"></span><span>${label}</span>`;
  document.getElementById("tile-pgv").textContent = fmt(cur.pgv_cms, 3);
  document.getElementById("tile-pga").textContent = fmt(cur.pga_gal, 2);

  document.getElementById("updated-line").textContent =
    `最後同步：${clockTime(new Date(snapshot.generated_at).getTime())}（${relTime(snapshot.generated_at)}）`;

  // waveform
  const wf = snapshot.waveform;
  const t0 = new Date(wf.t0).getTime();
  const wfPoints = (wf.values || []).map((v, i) => ({ t: t0 + i * wf.dt * 1000, v }));
  renderLineChart(
    document.getElementById("chart-waveform"),
    document.getElementById("tooltip-waveform"),
    wfPoints,
    { unit: "cm/s", yFmt: (v) => fmt(v, 3), symmetric: true, emptyMessage: "尚無波形資料" }
  );

  // trends
  const samples = history.samples || [];
  const histPoints = samples.map((s) => ({ t: new Date(s.t).getTime(), pga: s.pga, pgv: s.pgv }));
  renderLineChart(
    document.getElementById("chart-pga"),
    document.getElementById("tooltip-pga"),
    histPoints.map((p) => ({ t: p.t, v: p.pga })),
    { unit: "gal", yFmt: (v) => fmt(v, 1) }
  );
  renderLineChart(
    document.getElementById("chart-pgv"),
    document.getElementById("tooltip-pgv"),
    histPoints.map((p) => ({ t: p.t, v: p.pgv })),
    { unit: "cm/s", yFmt: (v) => fmt(v, 2) }
  );

  const recent = histPoints.slice(-60);
  renderSparkline(document.getElementById("spark-pgv"), recent.map((p) => p.pgv));
  renderSparkline(document.getElementById("spark-pga"), recent.map((p) => p.pga));
}

function initTheme() {
  const btn = document.getElementById("theme-toggle");
  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  btn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme")
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });
}

function initTabs() {
  const tabs = [
    { btn: "tab-btn-dashboard", panel: "panel-dashboard", key: "dashboard" },
    { btn: "tab-btn-architecture", panel: "panel-architecture", key: "architecture" },
  ];
  const saved = localStorage.getItem("tab") || "dashboard";

  function select(key) {
    for (const t of tabs) {
      const active = t.key === key;
      document.getElementById(t.btn).setAttribute("aria-selected", String(active));
      document.getElementById(t.panel).hidden = !active;
    }
    localStorage.setItem("tab", key);
  }

  for (const t of tabs) {
    document.getElementById(t.btn).addEventListener("click", () => select(t.key));
  }
  select(saved);
}

initTheme();
initTabs();
render();
setInterval(render, POLL_MS);
