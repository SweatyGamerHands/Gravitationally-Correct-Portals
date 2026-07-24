import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Camera, RotateCcw, Save, Share2, Trash2, X } from 'lucide-react';

export type SnapshotView = {
  id: string;
  name: string;
  createdAt: number | string | Date;
};

export type SnapshotPanelProps = {
  open: boolean;
  onClose: () => void;
  snapshots: SnapshotView[];
  onSave: (name: string) => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onShare: (id: string) => void;
};

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const formatCreatedAt = (createdAt: SnapshotView['createdAt']) => {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return String(createdAt);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export function SnapshotPanel({
  open,
  onClose,
  snapshots,
  onSave,
  onRestore,
  onDelete,
  onShare,
}: SnapshotPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const nameInputId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const [name, setName] = useState('');

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => nameInputRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ) as HTMLElement[];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panelRef.current.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSave(trimmedName);
    setName('');
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/80 p-0 backdrop-blur-xl sm:items-center sm:p-6"
          onPointerDown={event => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            tabIndex={-1}
            initial={{ opacity: 0, y: 32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.99 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="lab-mobile-sheet lab-scroll-area relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] border border-b-0 border-white/10 bg-[#0a0a0f] shadow-2xl ring-1 ring-black/50 sm:max-h-[86vh] sm:rounded-[30px] sm:border-b"
          >
            <header className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-white/10 bg-[#0a0a0f]/95 px-5 py-5 backdrop-blur-xl sm:px-7 sm:py-6">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#00a2ff]">
                  <Camera size={14} aria-hidden="true" />
                  Experiment memory
                </div>
                <h2 id={titleId} className="text-2xl font-light text-white">Snapshots</h2>
                <p id={descriptionId} className="mt-2 max-w-lg text-xs leading-relaxed text-white/40">
                  Bookmark the complete setup and return to it without reconstructing the experiment.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close snapshots"
                className="lab-touch-target inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="p-5 sm:p-7">
              <form onSubmit={handleSave} className="rounded-2xl border border-[#00a2ff]/20 bg-[#00a2ff]/5 p-3 sm:p-4">
                <label htmlFor={nameInputId} className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#00a2ff]/80">
                  Name this moment
                </label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    ref={nameInputRef}
                    id={nameInputId}
                    type="text"
                    value={name}
                    onChange={event => setName(event.currentTarget.value)}
                    maxLength={80}
                    autoComplete="off"
                    placeholder={`Experiment ${snapshots.length + 1}`}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 text-sm text-white placeholder:text-white/20 focus:border-[#00a2ff]/50 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!name.trim()}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#00a2ff] px-5 text-[10px] font-bold uppercase tracking-[0.14em] text-black shadow-[0_0_20px_rgba(0,162,255,0.22)] transition-colors hover:bg-[#35b5ff] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Save size={15} aria-hidden="true" />
                    Save snapshot
                  </button>
                </div>
              </form>

              <div className="mt-6 flex items-center justify-between gap-3">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.17em] text-white/45">Saved moments</h3>
                <span className="font-mono text-[9px] text-white/25">{snapshots.length} saved</span>
              </div>

              {snapshots.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {snapshots.map(snapshot => (
                    <li key={snapshot.id} className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white/85">{snapshot.name}</div>
                        <time className="mt-1 block text-[9px] uppercase tracking-wide text-white/25">
                          {formatCreatedAt(snapshot.createdAt)}
                        </time>
                      </div>
                      <div className="flex items-center gap-1.5" role="group" aria-label={`Actions for ${snapshot.name}`}>
                        <button
                          type="button"
                          onClick={() => onRestore(snapshot.id)}
                          className="lab-touch-target inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#00a2ff]/20 bg-[#00a2ff]/10 px-3 text-[9px] font-bold uppercase tracking-wider text-[#62c4ff] transition-colors hover:bg-[#00a2ff]/20 sm:flex-none"
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => onShare(snapshot.id)}
                          aria-label={`Copy share link for ${snapshot.name}`}
                          title="Copy share link"
                          className="lab-touch-target inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/45 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <Share2 size={15} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(snapshot.id)}
                          aria-label={`Delete ${snapshot.name}`}
                          title="Delete snapshot"
                          className="lab-touch-target inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white/35 transition-colors hover:border-red-400/25 hover:bg-red-400/10 hover:text-red-300"
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center">
                  <Camera size={23} className="mx-auto text-white/15" aria-hidden="true" />
                  <p className="mt-3 text-xs text-white/45">No snapshots yet.</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/25">Name the current moment above to create the first bookmark.</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
