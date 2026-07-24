import type { ReactNode } from 'react';
import {
  Clock3,
  Pause,
  Play,
  Redo2,
  Rewind as RewindIcon,
  StepForward,
  Undo2,
} from 'lucide-react';

export type TransportControlsProps = {
  playing: boolean;
  onToggle: () => void;
  onStep: () => void;
  onRewind: () => void;
  simTime: number;
  timelineIndex: number;
  timelineMax: number;
  onScrub: (index: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

type ControlButtonProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
};

const ControlButton = ({
  label,
  onClick,
  children,
  disabled = false,
  active,
  primary = false,
}: ControlButtonProps) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={active}
    title={label}
    className={`lab-touch-target inline-flex items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${
      primary
        ? 'border-[#00a2ff]/50 bg-[#00a2ff] text-black shadow-[0_0_24px_rgba(0,162,255,0.3)] hover:bg-[#35b5ff]'
        : 'border-white/10 bg-white/[0.04] text-white/55 hover:border-white/20 hover:bg-white/10 hover:text-white'
    }`}
  >
    {children}
  </button>
);

const formatSimTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '0.000 s';
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds < 60) return `${safeSeconds.toFixed(3)} s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
};

export function TransportControls({
  playing,
  onToggle,
  onStep,
  onRewind,
  simTime,
  timelineIndex,
  timelineMax,
  onScrub,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: TransportControlsProps) {
  const safeTimelineMax = Math.max(0, Math.floor(timelineMax));
  const safeTimelineIndex = Math.min(
    safeTimelineMax,
    Math.max(0, Math.floor(timelineIndex)),
  );
  const timelineDisabled = safeTimelineMax === 0;

  return (
    <section
      aria-label="Simulation transport"
      className="w-full rounded-2xl border border-white/10 bg-[#09090e]/90 p-2.5 shadow-2xl ring-1 ring-black/30 backdrop-blur-xl sm:p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" role="group" aria-label="Edit history">
          <ControlButton label="Undo last edit" onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={17} aria-hidden="true" />
          </ControlButton>
          <ControlButton label="Redo last edit" onClick={onRedo} disabled={!canRedo}>
            <Redo2 size={17} aria-hidden="true" />
          </ControlButton>
        </div>

        <div className="flex items-center gap-1.5" role="group" aria-label="Playback controls">
          <ControlButton
            label="Rewind to the beginning"
            onClick={onRewind}
            disabled={safeTimelineIndex === 0}
          >
            <RewindIcon size={17} aria-hidden="true" />
          </ControlButton>
          <ControlButton
            label={playing ? 'Pause simulation' : 'Play simulation'}
            onClick={onToggle}
            active={playing}
            primary
          >
            {playing
              ? <Pause size={18} fill="currentColor" aria-hidden="true" />
              : <Play size={18} fill="currentColor" aria-hidden="true" />}
          </ControlButton>
          <ControlButton label="Advance one physics frame" onClick={onStep}>
            <StepForward size={18} aria-hidden="true" />
          </ControlButton>
        </div>

        <div
          className="hidden min-h-11 items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3 font-mono text-[11px] text-white/70 sm:flex"
          aria-live="off"
        >
          <Clock3 size={14} className="text-[#00a2ff]" aria-hidden="true" />
          <span className="sr-only">Simulation time:</span>
          <span className="tabular-nums">{formatSimTime(simTime)}</span>
          <span className={`h-1.5 w-1.5 rounded-full ${playing ? 'animate-pulse bg-emerald-400' : 'bg-[#ff9d00]'}`} aria-hidden="true" />
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-t border-white/[0.07] pt-2.5">
        <span className="hidden text-[9px] font-bold uppercase tracking-[0.16em] text-white/30 sm:block">
          Timeline
        </span>
        <input
          type="range"
          min={0}
          max={safeTimelineMax}
          step={1}
          value={safeTimelineIndex}
          disabled={timelineDisabled}
          onChange={event => onScrub(Number(event.currentTarget.value))}
          aria-label="Simulation timeline"
          aria-valuetext={`Frame ${safeTimelineIndex} of ${safeTimelineMax}`}
          className="w-full accent-[#00a2ff] disabled:opacity-30"
        />
        <span className="min-w-[4.75rem] text-right font-mono text-[10px] tabular-nums text-white/35">
          {safeTimelineIndex} / {safeTimelineMax}
        </span>
      </div>
    </section>
  );
}
