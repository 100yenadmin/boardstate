// builtin:chart — dependency-free inline-SVG timeseries visuals. One renderer
// switches on `props.type` (line | bar | area | sparkline | gauge); every type
// binds to a single timeseries `value`. The `mapChart`/`normalizeSeries` transform
// lives in `@boardstate/core`; this module only draws the resolved model.

import { html, nothing, svg, type SVGTemplateResult, type TemplateResult } from "lit";
import {
  mapChart,
  toFiniteNumber,
  widgetProps,
  type ChartModel,
  type DashboardWidget,
} from "@boardstate/core";
import { t } from "../strings.js";

// Fixed viewBox — the SVG scales to the grid cell via width/height:100%. A
// compact aspect keeps the visuals axis-light and readable at small sizes.
const VIEW_W = 100;
const VIEW_H = 40;
const PAD = 2;

/** Map a value onto the [PAD, VIEW_H-PAD] band, flat-lining a zero-range series. */
function yScale(v: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) {
    return VIEW_H / 2;
  }
  const norm = (v - min) / span;
  return VIEW_H - PAD - norm * (VIEW_H - PAD * 2);
}

/** X position for the i-th of n points across the padded width. */
function xScale(i: number, n: number): number {
  if (n <= 1) {
    return VIEW_W / 2;
  }
  return PAD + (i / (n - 1)) * (VIEW_W - PAD * 2);
}

function linePoints(values: number[], min: number, max: number): string {
  return values.map((v, i) => `${xScale(i, values.length)},${yScale(v, min, max)}`).join(" ");
}

// Compact numeric label for detail-mode axes and the sparkline value badge, e.g.
// `1234567` → `1.2M`. Text always renders inert (interpolated, never innerHTML).
const numberFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
function formatValue(v: number): string {
  return Number.isFinite(v) ? numberFormat.format(v) : "";
}

/** Trend of a sparkline series (last vs first) — drives its delta coloring. */
type SparkTrend = "up" | "down" | "flat";
function sparkTrend(values: number[]): SparkTrend {
  if (values.length < 2) {
    return "flat";
  }
  const first = values[0]!;
  const last = values[values.length - 1]!;
  return last > first ? "up" : last < first ? "down" : "flat";
}

function drawLine(model: ChartModel): SVGTemplateResult {
  const points = linePoints(model.values, model.min, model.max);
  return svg`<polyline
    class="dashboard-chart__line"
    fill="none"
    points=${points}
  />`;
}

function drawArea(model: ChartModel): SVGTemplateResult {
  const points = linePoints(model.values, model.min, model.max);
  const first = xScale(0, model.values.length);
  const last = xScale(model.values.length - 1, model.values.length);
  const base = VIEW_H - PAD;
  const fill = `${first},${base} ${points} ${last},${base}`;
  return svg`<g>
    <polygon class="dashboard-chart__area" points=${fill} />
    <polyline class="dashboard-chart__line" fill="none" points=${points} />
  </g>`;
}

function drawBars(model: ChartModel): SVGTemplateResult {
  const n = model.values.length;
  const slot = (VIEW_W - PAD * 2) / n;
  const gap = slot > 3 ? Math.min(1, slot * 0.2) : 0;
  const width = Math.max(slot - gap, 0.5);
  const base = VIEW_H - PAD;
  return svg`<g class="dashboard-chart__bars">
    ${model.values.map((v, i) => {
      const y = yScale(v, model.min, model.max);
      const x = PAD + i * slot + gap / 2;
      return svg`<rect x=${x} y=${y} width=${width} height=${Math.max(base - y, 0)} />`;
    })}
  </g>`;
}

/** Gauge — a 180° arc with a needle at the value's position in [min,max]. */
function drawGauge(model: ChartModel, props: Record<string, unknown>): SVGTemplateResult {
  // Gauge reads the LAST sample as the current level; props may pin the scale.
  const current = model.values.length ? model.values[model.values.length - 1]! : 0;
  const lo = toFiniteNumber(props.min) ?? Math.min(model.min, 0);
  const hi = toFiniteNumber(props.max) ?? Math.max(model.max, current);
  const span = hi - lo;
  const frac = span > 0 ? Math.min(Math.max((current - lo) / span, 0), 1) : 0;

  const cx = VIEW_W / 2;
  const cy = VIEW_H - PAD;
  const r = Math.min(VIEW_W / 2, VIEW_H) - PAD;
  const polar = (fraction: number) => {
    const angle = Math.PI - fraction * Math.PI; // π (left) → 0 (right)
    return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  };
  const start = polar(0);
  const end = polar(1);
  const value = polar(frac);
  const track = `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`;
  const fill = `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${value.x} ${value.y}`;
  return svg`<g class="dashboard-chart__gauge">
    <path class="dashboard-chart__gauge-track" fill="none" d=${track} />
    <path class="dashboard-chart__gauge-fill" fill="none" d=${fill} />
    <line class="dashboard-chart__gauge-needle" x1=${cx} y1=${cy} x2=${value.x} y2=${value.y} />
  </g>`;
}

// Sparkline — a minimal, axis-free line delta-colored by its trend (up/down/flat),
// with an optional trailing value label rendered as HTML (see renderChart). It stays
// tight even in detail mode. Degrades to a single end dot when only one point exists.
function drawSparkline(model: ChartModel): SVGTemplateResult {
  const n = model.values.length;
  const trend = sparkTrend(model.values);
  if (n < 2) {
    const cx = xScale(0, n);
    const cy = yScale(model.values[0] ?? 0, model.min, model.max);
    return svg`<g class="dashboard-chart__spark dashboard-chart__spark--${trend}">
      <circle class="dashboard-chart__spark-dot" cx=${cx} cy=${cy} r="1.5" />
    </g>`;
  }
  const points = linePoints(model.values, model.min, model.max);
  return svg`<g class="dashboard-chart__spark dashboard-chart__spark--${trend}">
    <polyline class="dashboard-chart__line" fill="none" points=${points} />
  </g>`;
}

/** Only the cartesian types carry a y-axis; gauge and sparkline never do. */
function hasAxes(type: ChartModel["type"]): boolean {
  return type === "line" || type === "area" || type === "bar";
}

/** Detail-mode gridlines — three faint horizontals at the min/mid/max bands. */
function drawGrid(): SVGTemplateResult {
  const rows = [PAD, VIEW_H / 2, VIEW_H - PAD];
  return svg`<g class="dashboard-chart__grid">
    ${rows.map((y) => svg`<line x1=${PAD} y1=${y} x2=${VIEW_W - PAD} y2=${y} />`)}
  </g>`;
}

// Detail-mode value tooltips — a transparent hover layer whose per-point `<title>`
// children surface the value via the browser's native tooltip (no new dependency,
// no innerHTML). Kept as a separate overlay so the base draw stays byte-identical.
function drawTips(model: ChartModel): SVGTemplateResult {
  const n = model.values.length;
  if (model.type === "bar") {
    const slot = (VIEW_W - PAD * 2) / n;
    return svg`<g class="dashboard-chart__tips">
      ${model.values.map(
        (v, i) =>
          svg`<rect class="dashboard-chart__tip" x=${PAD + i * slot} y=${PAD} width=${slot} height=${VIEW_H - PAD * 2}><title>${formatValue(v)}</title></rect>`,
      )}
    </g>`;
  }
  if (model.type === "gauge") {
    const current = n ? model.values[n - 1]! : 0;
    return svg`<g class="dashboard-chart__tips">
      <rect class="dashboard-chart__tip" x=${PAD} y=${PAD} width=${VIEW_W - PAD * 2} height=${VIEW_H - PAD * 2}><title>${formatValue(current)}</title></rect>
    </g>`;
  }
  // line + area — one hover dot per sample.
  return svg`<g class="dashboard-chart__tips">
    ${model.values.map(
      (v, i) =>
        svg`<circle class="dashboard-chart__tip" cx=${xScale(i, n)} cy=${yScale(v, model.min, model.max)} r="2.5"><title>${formatValue(v)}</title></circle>`,
    )}
  </g>`;
}

function drawBase(model: ChartModel, props: Record<string, unknown>): SVGTemplateResult {
  switch (model.type) {
    case "bar":
      return drawBars(model);
    case "area":
      return drawArea(model);
    case "gauge":
      return drawGauge(model, props);
    case "sparkline":
      return drawSparkline(model);
    default:
      return drawLine(model);
  }
}

function drawChart(model: ChartModel, props: Record<string, unknown>): SVGTemplateResult {
  const base = drawBase(model, props);
  // Sparkline stays minimal; every other type renders byte-identically unless detail
  // mode is on, which layers gridlines under and value tooltips over the base draw.
  if (!model.detail || model.type === "sparkline") {
    return base;
  }
  return svg`<g>
    ${hasAxes(model.type) ? drawGrid() : nothing}
    ${base}
    ${drawTips(model)}
  </g>`;
}

export function renderChart(widget: DashboardWidget, value: unknown): TemplateResult {
  const model = mapChart(widget, value);
  if (model.values.length === 0) {
    return html`<div class="dashboard-widget__placeholder">
      ${t("dashboard.widget.chart.empty")}
    </div>`;
  }
  const props = widgetProps(widget);
  // Overlays are HTML siblings of the (aspect-stretched) SVG so their text stays
  // undistorted. Both are opt-in — a default chart adds no extra element, so existing
  // docs render exactly as before.
  const detail = model.detail && model.type !== "sparkline";
  const axes = detail && hasAxes(model.type);
  const sparkValue = model.type === "sparkline" && model.label;
  const detailClass = detail ? " dashboard-chart--detail" : "";
  return html`
    <div class="dashboard-chart dashboard-chart--${model.type}${detailClass}">
      <svg
        class="dashboard-chart__svg"
        viewBox="0 0 ${VIEW_W} ${VIEW_H}"
        preserveAspectRatio="none"
        role="img"
        aria-label=${widget.title ?? t("dashboard.widget.chart.label")}
        data-test-id="dashboard-chart"
      >
        ${drawChart(model, props)}
      </svg>
      ${
        axes
          ? html`<span class="dashboard-chart__axis dashboard-chart__axis--max"
                >${formatValue(model.max)}</span
              ><span class="dashboard-chart__axis dashboard-chart__axis--min"
                >${formatValue(model.min)}</span
              >`
          : nothing
      }
      ${
        sparkValue
          ? html`<span
              class="dashboard-chart__spark-value dashboard-chart__spark-value--${sparkTrend(
                model.values,
              )}"
              >${formatValue(model.values[model.values.length - 1] ?? 0)}</span
            >`
          : nothing
      }
    </div>
  `;
}
