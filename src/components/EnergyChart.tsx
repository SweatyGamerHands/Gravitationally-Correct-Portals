import { useId, useMemo } from 'react';
import { Activity, Gauge } from 'lucide-react';

export type EnergySample = {
  time: number;
  kinetic: number;
  potential: number;
  total: number;
};

export type EnergyChartProps = {
  samples: EnergySample[];
  kinetic: number;
  potential: number;
  total: number;
  drift: number;
};

const WIDTH = 640;
const HEIGHT = 176;
const PADDING = { top: 16, right: 16, bottom: 24, left: 54 };

const formatEnergy = (value: number) => {
  if (!Number.isFinite(value)) return '--';
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute >= 100_000 || absolute < 0.01)) return value.toExponential(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const formatAxisEnergy = (value: number) => {
  if (!Number.isFinite(value)) return '--';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(absolute < 10 ? 1 : 0);
};

export function EnergyChart({
  samples,
  kinetic,
  potential,
  total,
  drift,
}: EnergyChartProps) {
  const titleId = useId();
  const descriptionId = useId();

  const chart = useMemo(() => {
    const valid = samples.filter(sample => (
      Number.isFinite(sample.time)
      && Number.isFinite(sample.kinetic)
      && Number.isFinite(sample.potential)
      && Number.isFinite(sample.total)
    ));

    if (valid.length === 0) return null;
    const timeMin = Math.min(...valid.map(sample => sample.time));
    const timeMax = Math.max(...valid.map(sample => sample.time));
    const values = valid.flatMap(sample => [sample.kinetic, sample.potential, sample.total]);
    let valueMin = Math.min(0, ...values);
    let valueMax = Math.max(0, ...values);
    if (Math.abs(valueMax - valueMin) < 1e-9) {
      const padding = Math.max(1, Math.abs(valueMax) * 0.1);
      valueMin -= padding;
      valueMax += padding;
    }

    const plotWidth = WIDTH - PADDING.left - PADDING.right;
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const timeRange = Math.max(1e-9, timeMax - timeMin);
    const valueRange = valueMax - valueMin;
    const x = (time: number, index: number) => (
      PADDING.left
      + (valid.length === 1
        ? plotWidth / 2
        : ((time - timeMin) / timeRange || index / (valid.length - 1)) * plotWidth)
    );
    const y = (value: number) => PADDING.top + (valueMax - value) / valueRange * plotHeight;
    const pathFor = (key: 'kinetic' | 'potential' | 'total') => valid
      .map((sample, index) => `${index === 0 ? 'M' : 'L'} ${x(sample.time, index).toFixed(2)} ${y(sample[key]).toFixed(2)}`)
      .join(' ');

    return {
      valid,
      timeMin,
      timeMax,
      valueMin,
      valueMax,
      plotHeight,
      pathFor,
      pointX: (sample: EnergySample, index: number) => x(sample.time, index),
      pointY: (value: number) => y(value),
    };
  }, [samples]);

  const driftMagnitude = Math.abs(drift);
  const driftColor = !Number.isFinite(drift)
    ? 'text-white/35'
    : driftMagnitude <= 0.1
      ? 'text-emerald-300'
      : driftMagnitude <= 1
        ? 'text-[#ffbd55]'
        : 'text-red-300';

  const ledger = [
    { label: 'Kinetic', value: kinetic, color: 'text-[#ff9d00]' },
    { label: 'Potential', value: potential, color: 'text-[#00a2ff]' },
    { label: 'Total', value: total, color: 'text-emerald-300' },
  ];

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0f0f19] p-4" aria-labelledby={titleId}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Gauge size={14} className="text-[#00a2ff]" aria-hidden="true" />
            <h2 id={titleId} className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/65">
              Energy ledger
            </h2>
          </div>
          <p className="mt-1 text-[9px] uppercase tracking-wide text-white/25">Model units over simulation time</p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[9px] uppercase tracking-wider text-white/30">
          Drift <span className={`ml-1 font-mono tabular-nums ${driftColor}`}>{Number.isFinite(drift) ? `${drift >= 0 ? '+' : ''}${drift.toFixed(3)}%` : '--'}</span>
        </div>
      </header>

      <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-black/25">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-44 w-full"
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <desc id={descriptionId}>
            Energy history with kinetic, potential, and total energy lines. Current total energy is {formatEnergy(total)} model units.
          </desc>
          <defs>
            <linearGradient id={`${titleId}-background`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00a2ff" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#00a2ff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect width={WIDTH} height={HEIGHT} fill={`url(#${titleId}-background)`} />

          {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
            const y = PADDING.top + ratio * (HEIGHT - PADDING.top - PADDING.bottom);
            const value = chart ? chart.valueMax - ratio * (chart.valueMax - chart.valueMin) : 0;
            return (
              <g key={ratio}>
                <line
                  x1={PADDING.left}
                  x2={WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
                {chart && (
                  <text x={PADDING.left - 7} y={y + 3} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
                    {formatAxisEnergy(value)}
                  </text>
                )}
              </g>
            );
          })}

          {chart && (
            <>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={chart.pointY(0)}
                y2={chart.pointY(0)}
                stroke="rgba(255,255,255,0.16)"
                strokeDasharray="4 5"
                vectorEffect="non-scaling-stroke"
              />
              <path d={chart.pathFor('kinetic')} fill="none" stroke="#ff9d00" strokeWidth="1.7" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={chart.pathFor('potential')} fill="none" stroke="#00a2ff" strokeWidth="1.7" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <path d={chart.pathFor('total')} fill="none" stroke="#6ee7c7" strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {chart.valid.length === 1 && (
                <>
                  <circle cx={chart.pointX(chart.valid[0], 0)} cy={chart.pointY(chart.valid[0].kinetic)} r="2.5" fill="#ff9d00" />
                  <circle cx={chart.pointX(chart.valid[0], 0)} cy={chart.pointY(chart.valid[0].potential)} r="2.5" fill="#00a2ff" />
                  <circle cx={chart.pointX(chart.valid[0], 0)} cy={chart.pointY(chart.valid[0].total)} r="2.5" fill="#6ee7c7" />
                </>
              )}
              <text x={PADDING.left} y={HEIGHT - 7} fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
                {chart.timeMin.toFixed(2)} s
              </text>
              <text x={WIDTH - PADDING.right} y={HEIGHT - 7} textAnchor="end" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="monospace">
                {chart.timeMax.toFixed(2)} s
              </text>
            </>
          )}
        </svg>

        {!chart && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <Activity size={18} className="text-white/15" aria-hidden="true" />
            <span className="mt-2 text-[10px] text-white/30">Energy history begins when the simulation advances.</span>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ledger.map(item => (
          <div key={item.label} className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
            <div className="text-[8px] font-bold uppercase tracking-[0.14em] text-white/25">{item.label}</div>
            <div className={`mt-1 truncate font-mono text-xs tabular-nums ${item.color}`} title={formatEnergy(item.value)}>
              {formatEnergy(item.value)}
            </div>
          </div>
        ))}
        <div className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <div className="text-[8px] font-bold uppercase tracking-[0.14em] text-white/25">Drift</div>
          <div className={`mt-1 truncate font-mono text-xs tabular-nums ${driftColor}`}>
            {Number.isFinite(drift) ? `${drift >= 0 ? '+' : ''}${drift.toFixed(3)}%` : '--'}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[9px] text-white/35" aria-hidden="true">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[#ff9d00]" /> Kinetic</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-[#00a2ff]" /> Potential</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-emerald-300" /> Total</span>
      </div>
    </section>
  );
}
