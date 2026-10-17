import { useId } from "react";

// Lightweight SVG line chart. series: [{ values:number[], className }]
export default function LineChart({ series, height = 120, labels, ariaLabel }) {
  const id = useId();
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (all.length < 2) return null;
  const width = 320;
  const pad = 4;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const len = Math.max(...series.map((s) => s.values.length));
  const x = (i) => pad + (i / Math.max(len - 1, 1)) * (width - pad * 2);
  const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2);

  return (
    <figure className="chart" aria-label={ariaLabel}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
          if (pts.length < 2) return null;
          const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
          return (
            <g key={si}>
              {s.fill && <path d={`${d} L${pts.at(-1)[0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#fill-${id})`} />}
              <path d={d} className={s.className} fill="none" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
      </svg>
      {labels && (
        <figcaption className="chart-labels">
          <span>{labels[0]}</span>
          <span>{labels[1]}</span>
        </figcaption>
      )}
    </figure>
  );
}
