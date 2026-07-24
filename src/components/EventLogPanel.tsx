import { useId, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Activity, ChevronDown, Eraser, Lightbulb } from 'lucide-react';

export type LabEventTone = 'neutral' | 'info' | 'portal' | 'success' | 'warning' | 'danger';

export type LabEventView = {
  id: string;
  time: number;
  kind: string;
  title: string;
  summary: string;
  explanation: string;
  tone: LabEventTone;
};

export type EventLogPanelProps = {
  events: LabEventView[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
};

const toneStyles: Record<LabEventTone, { dot: string; border: string; badge: string }> = {
  neutral: {
    dot: 'bg-white/45',
    border: 'border-white/10',
    badge: 'border-white/10 bg-white/5 text-white/45',
  },
  info: {
    dot: 'bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.45)]',
    border: 'border-cyan-300/20',
    badge: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200',
  },
  portal: {
    dot: 'bg-[#00a2ff] shadow-[0_0_12px_rgba(0,162,255,0.55)]',
    border: 'border-[#00a2ff]/25',
    badge: 'border-[#00a2ff]/20 bg-[#00a2ff]/10 text-[#62c4ff]',
  },
  success: {
    dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.45)]',
    border: 'border-emerald-400/20',
    badge: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  },
  warning: {
    dot: 'bg-[#ff9d00] shadow-[0_0_12px_rgba(255,157,0,0.5)]',
    border: 'border-[#ff9d00]/25',
    badge: 'border-[#ff9d00]/20 bg-[#ff9d00]/10 text-[#ffbd55]',
  },
  danger: {
    dot: 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.45)]',
    border: 'border-red-400/25',
    badge: 'border-red-400/20 bg-red-400/10 text-red-300',
  },
};

const formatEventTime = (time: number) => (
  Number.isFinite(time) ? `${Math.max(0, time).toFixed(3)} s` : '--'
);

export function EventLogPanel({
  events,
  selectedId,
  onSelect,
  onClear,
}: EventLogPanelProps) {
  const panelId = useId();
  const orderedEvents = useMemo(
    () => events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => b.event.time - a.event.time || b.index - a.index)
      .map(({ event }) => event),
    [events],
  );

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-[#0f0f19]" aria-labelledby={`${panelId}-title`}>
      <header className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-[#00a2ff]" aria-hidden="true" />
            <h2 id={`${panelId}-title`} className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/65">
              Event log
            </h2>
          </div>
          <p className="mt-1 text-[9px] uppercase tracking-wide text-white/25">
            Newest first · {events.length} {events.length === 1 ? 'event' : 'events'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={events.length === 0}
          className="lab-touch-target inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[9px] font-bold uppercase tracking-wider text-white/35 transition-colors hover:border-red-400/25 hover:bg-red-400/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-25"
        >
          <Eraser size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Clear</span>
        </button>
      </header>

      {orderedEvents.length > 0 ? (
        <ol className="lab-scroll-area min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {orderedEvents.map((event, index) => {
            const selected = event.id === selectedId;
            const styles = toneStyles[event.tone] ?? toneStyles.neutral;
            const explanationId = `${panelId}-explanation-${index}`;

            return (
              <li key={event.id} className={`overflow-hidden rounded-xl border transition-colors ${selected ? styles.border : 'border-white/[0.07]'} ${selected ? 'bg-white/[0.055]' : 'bg-black/15 hover:bg-white/[0.035]'}`}>
                <button
                  type="button"
                  onClick={() => onSelect(event.id)}
                  aria-expanded={selected}
                  aria-controls={explanationId}
                  className="flex min-h-11 w-full items-start gap-3 px-3 py-3 text-left"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${styles.dot}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-xs font-semibold text-white/85">{event.title}</span>
                      <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${styles.badge}`}>
                        {event.kind}
                      </span>
                    </span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-white/40">{event.summary}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="font-mono text-[9px] tabular-nums text-white/25">{formatEventTime(event.time)}</span>
                    <ChevronDown size={14} className={`text-white/25 transition-transform ${selected ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {selected && (
                    <motion.div
                      id={explanationId}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="mx-3 mb-3 flex gap-2.5 rounded-lg border border-white/[0.07] bg-black/25 p-3">
                        <Lightbulb size={14} className="mt-0.5 shrink-0 text-[#ff9d00]" aria-hidden="true" />
                        <div>
                          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#ff9d00]/80">
                            Why did that happen?
                          </div>
                          <p className="mt-1 text-[10px] leading-relaxed text-white/50">
                            {event.explanation || 'No causal explanation was recorded for this event.'}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="flex min-h-44 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
            <Activity size={19} className="text-white/20" aria-hidden="true" />
          </div>
          <p className="mt-3 text-xs font-medium text-white/50">No events recorded</p>
          <p className="mt-1 max-w-52 text-[10px] leading-relaxed text-white/25">
            Cross a portal, strike a rim, or move a mouth through an object to begin the causal record.
          </p>
        </div>
      )}
    </section>
  );
}
