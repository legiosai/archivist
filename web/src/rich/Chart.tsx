import type { ChartSpec } from "../markdown-parse.ts";

// Categorical hues in a fixed order, stepped for a dark surface and checked for color-blind
// separation between neighbours. A single series takes archivist's amber instead.
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"];
const ONE = "#f0b54d";
const SURFACE = "#15151b";

const W = 360, H = 220;
const M = { top: 14, right: 10, bottom: 34, left: 42 };

const fmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
const short = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
const tick = (v: number) => (Math.abs(v) >= 10_000 ? short.format(v) : fmt.format(v));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Round numbers for the y axis that cover [lo, hi]. */
function ticks(lo: number, hi: number, count = 4): number[] {
  if (lo === hi) { hi = lo + 1; lo = Math.min(0, lo); }
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  if (out.at(-1)! < hi) out.push(out.at(-1)! + step);
  return out;
}

/** A bar with its data end rounded (4px) and its baseline end square. */
function bar(x: number, w: number, y0: number, y1: number): string {
  const up = y1 <= y0;
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, w / 2, h);
  if (up) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function Legend({ items }: { items: { name: string; color: string; note?: string }[] }) {
  return (
    <ul className="md-chart-legend">
      {items.map((it) => (
        <li key={it.name}><span className="md-chart-swatch" style={{ background: it.color }} aria-hidden="true" />{it.name}
          {it.note && <span className="md-chart-note">{it.note}</span>}</li>
      ))}
    </ul>
  );
}

function DataTable({ spec }: { spec: ChartSpec }) {
  const series = spec.type === "pie" ? spec.series.slice(0, 1) : spec.series;
  return (
    <details className="md-chart-data">
      <summary>Ver datos</summary>
      <div className="md-table-wrap">
        <table>
          <thead><tr><th>{spec.x || ""}</th>{series.map((s) => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
          <tbody>
            {spec.labels.map((l, i) => (
              <tr key={i}><td>{l}</td>{series.map((s) => <td key={s.name} className="num">{s.data[i] === undefined ? "" : fmt.format(s.data[i]!)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Pie({ spec }: { spec: ChartSpec }) {
  const s = spec.series[0]!;
  let slices = spec.labels.map((l, i) => ({ name: l, value: Math.max(0, s.data[i] ?? 0) })).filter((x) => x.value > 0);
  if (slices.length > SERIES.length) {   // past eight slices the rest fold into "Otros"
    const keep = [...slices].sort((a, b) => b.value - a.value).slice(0, SERIES.length - 1);
    const rest = slices.filter((x) => !keep.includes(x)).reduce((a, x) => a + x.value, 0);
    slices = [...slices.filter((x) => keep.includes(x)), { name: "Otros", value: rest }];
  }
  const total = slices.reduce((a, x) => a + x.value, 0);
  const cx = 100, cy = 100, r = 86, inner = 48;
  let angle = -Math.PI / 2;
  const arcs = slices.map((x, i) => {
    const a0 = angle, a1 = angle + (x.value / total) * Math.PI * 2;
    angle = a1;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const d = slices.length === 1
      ? `M${cx - r},${cy}A${r},${r} 0 1 1 ${cx + r},${cy}A${r},${r} 0 1 1 ${cx - r},${cy}M${cx - inner},${cy}A${inner},${inner} 0 1 0 ${cx + inner},${cy}A${inner},${inner} 0 1 0 ${cx - inner},${cy}Z`
      : `M${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, inner)}A${inner},${inner} 0 ${large} 0 ${p(a0, inner)}Z`;
    return { ...x, d, color: SERIES[i]!, share: x.value / total };
  });
  return (
    <div className="md-chart-pie">
      <svg viewBox="0 0 200 200" role="img" aria-label={spec.title || "Gráfico de torta"}>
        {arcs.map((a) => (
          <path key={a.name} d={a.d} fill={a.color} stroke={SURFACE} strokeWidth={2} fillRule="evenodd" className="md-chart-mark">
            <title>{`${a.name}: ${fmt.format(a.value)} (${Math.round(a.share * 100)} %)`}</title>
          </path>
        ))}
      </svg>
      <Legend items={arcs.map((a) => ({ name: a.name, color: a.color, note: `${Math.round(a.share * 100)} %` }))} />
    </div>
  );
}

function Axes({ spec, children }: { spec: ChartSpec; children: (scale: { x: (i: number) => number; band: number; y: (v: number) => number; base: number }) => React.ReactNode }) {
  const values = spec.series.flatMap((s) => s.data);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (spec.type === "bar" || (lo >= 0 && lo < hi * 0.3)) lo = Math.min(0, lo);
  if (spec.type === "bar") hi = Math.max(0, hi);
  const ys = ticks(lo, hi);
  const y0 = ys[0]!, y1 = ys.at(-1)!;
  const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
  const n = spec.labels.length;
  const band = pw / n;
  const y = (v: number) => M.top + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const x = (i: number) => M.left + band * i + band / 2;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 46))));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={spec.title || "Gráfico"} className="md-chart-svg">
      {ys.map((v) => (
        <g key={v}>
          <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} className={v === 0 ? "md-chart-zero" : "md-chart-grid"} />
          <text x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="md-chart-tick">{tick(v)}</text>
        </g>
      ))}
      {spec.labels.map((l, i) => (i % every === 0 || i === n - 1) && (
        <text key={i} x={x(i)} y={H - M.bottom + 15} textAnchor="middle" className="md-chart-tick">{clip(l, every > 1 ? 8 : Math.max(4, Math.floor(band / 6.2)))}</text>
      ))}
      {spec.x && <text x={M.left + pw / 2} y={H - 3} textAnchor="middle" className="md-chart-axis">{clip(spec.x, 50)}</text>}
      {spec.y && <text transform={`translate(10 ${M.top + ph / 2}) rotate(-90)`} textAnchor="middle" className="md-chart-axis">{clip(spec.y, 30)}</text>}
      {children({ x, band, y, base: y(Math.max(y0, Math.min(0, y1))) })}
    </svg>
  );
}

function Bars({ spec }: { spec: ChartSpec }) {
  const color = (k: number) => (spec.series.length === 1 ? ONE : SERIES[k]!);
  const all = spec.series.flatMap((s) => s.data);
  const max = Math.max(...all);
  return (
    <Axes spec={spec}>
      {({ x, band, y, base }) => {
        const k = spec.series.length;
        const gap = 2;
        const w = Math.max(2, Math.min(28, (band * 0.72 - gap * (k - 1)) / k));
        const group = w * k + gap * (k - 1);
        let labelled = false;
        return spec.series.map((s, si) => s.data.map((v, i) => {
          const left = x(i) - group / 2 + si * (w + gap);
          const showValue = k === 1 && v === max && !labelled && (labelled = true);
          return (
            <g key={`${si}-${i}`} className="md-chart-mark">
              <rect x={x(i) - band / 2} y={M.top} width={band} height={H - M.top - M.bottom} fill="transparent" />
              <path d={bar(left, w, base, y(v))} fill={color(si)} />
              {showValue && <text x={left + w / 2} y={y(v) - 5} textAnchor="middle" className="md-chart-value">{fmt.format(v)}</text>}
              <title>{`${spec.labels[i]}${k > 1 ? ` · ${s.name}` : ""}: ${fmt.format(v)}`}</title>
            </g>
          );
        }));
      }}
    </Axes>
  );
}

function Lines({ spec }: { spec: ChartSpec }) {
  const color = (k: number) => (spec.series.length === 1 ? ONE : SERIES[k]!);
  return (
    <Axes spec={spec}>
      {({ x, y }) => spec.series.map((s, si) => (
        <g key={si}>
          <polyline points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={color(si)} strokeWidth={2}
                    strokeLinejoin="round" strokeLinecap="round" />
          {s.data.length <= 24 && s.data.map((v, i) => (
            <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={color(si)} stroke={SURFACE} strokeWidth={2} className="md-chart-mark">
              <title>{`${spec.labels[i]}${spec.series.length > 1 ? ` · ${s.name}` : ""}: ${fmt.format(v)}`}</title>
            </circle>
          ))}
          {spec.series.length > 1 && spec.series.length <= 4 && (
            <text x={x(s.data.length - 1) - 4} y={y(s.data.at(-1)!) - 9} textAnchor="end" className="md-chart-value">{clip(s.name, 14)}</text>
          )}
        </g>
      ))}
    </Axes>
  );
}

/** A small chart the model described in a ```chart block, drawn here as SVG. */
export default function Chart({ spec }: { spec: ChartSpec }) {
  return (
    <figure className="md-chart">
      {spec.title && <figcaption className="md-chart-title">{spec.title}</figcaption>}
      {spec.type === "pie" ? <Pie spec={spec} /> : spec.type === "line" ? <Lines spec={spec} /> : <Bars spec={spec} />}
      {spec.type !== "pie" && spec.series.length > 1 && <Legend items={spec.series.map((s, k) => ({ name: s.name, color: SERIES[k]! }))} />}
      <DataTable spec={spec} />
    </figure>
  );
}
