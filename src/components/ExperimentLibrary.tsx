import { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, FlaskConical, Sparkles, X } from 'lucide-react';

export type ExperimentCardData = {
  id: string;
  title: string;
  question: string;
  description: string;
  accent?: string;
  tags?: string[];
};

export type ExperimentLibraryProps = {
  open: boolean;
  onClose: () => void;
  experiments: ExperimentCardData[];
  onLoad: (experiment: ExperimentCardData) => void;
  onSurprise: () => void;
};

const focusableSelector = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function ExperimentLibrary({
  open,
  onClose,
  experiments,
  onLoad,
  onSurprise,
}: ExperimentLibraryProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

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
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

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
            className="lab-mobile-sheet lab-scroll-area relative max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-t-[28px] border border-b-0 border-white/10 bg-[#0a0a0f] shadow-2xl ring-1 ring-black/50 sm:max-h-[88vh] sm:rounded-[32px] sm:border-b"
          >
            <header className="sticky top-0 z-20 flex items-start justify-between gap-4 border-b border-white/10 bg-[#0a0a0f]/95 px-5 py-5 backdrop-blur-xl sm:px-8 sm:py-7">
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#00a2ff]">
                  <FlaskConical size={14} aria-hidden="true" />
                  Experiment library
                </div>
                <h2 id={titleId} className="text-2xl font-light text-white sm:text-3xl">
                  Start with a question
                </h2>
                <p id={descriptionId} className="mt-2 max-w-2xl text-xs leading-relaxed text-white/45 sm:text-sm">
                  Load a prepared setup, change one thing, and observe what the model predicts.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close experiment library"
                className="lab-touch-target inline-flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="p-5 sm:p-8">
              <button
                type="button"
                onClick={onSurprise}
                className="group mb-6 flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl border border-[#ff9d00]/30 bg-[linear-gradient(110deg,rgba(255,157,0,0.14),rgba(255,157,0,0.03))] px-4 py-3 text-left transition-colors hover:border-[#ff9d00]/55 hover:bg-[#ff9d00]/15 sm:px-5"
              >
                <span className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ff9d00]/15 text-[#ff9d00] shadow-[0_0_24px_rgba(255,157,0,0.15)]">
                    <Sparkles size={18} aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-xs font-semibold text-white">Surprise me</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-white/40 sm:text-xs">
                      Generate a valid configuration with an interesting physical interaction.
                    </span>
                  </span>
                </span>
                <ArrowRight size={17} className="shrink-0 text-[#ff9d00] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </button>

              {experiments.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {experiments.map(experiment => {
                    const accent = experiment.accent ?? '#00a2ff';
                    return (
                      <article
                        key={experiment.id}
                        className="group relative overflow-hidden rounded-2xl border bg-white/[0.025] p-5 transition-transform hover:-translate-y-0.5"
                        style={{
                          borderColor: `color-mix(in srgb, ${accent} 28%, transparent)`,
                          backgroundImage: `linear-gradient(145deg, color-mix(in srgb, ${accent} 8%, transparent), transparent 55%)`,
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-5 left-0 w-0.5 rounded-full"
                          style={{ backgroundColor: accent }}
                        />
                        <div className="mb-4 flex items-start justify-between gap-4">
                          <div>
                            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/30">
                              {experiment.title}
                            </div>
                            <h3 className="mt-2 text-lg font-medium leading-snug text-white">
                              {experiment.question}
                            </h3>
                          </div>
                          <span
                            aria-hidden="true"
                            className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_14px_currentColor]"
                            style={{ backgroundColor: accent, color: accent }}
                          />
                        </div>

                        <p className="text-xs leading-relaxed text-white/45">{experiment.description}</p>

                        {experiment.tags && experiment.tags.length > 0 && (
                          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Experiment topics">
                            {experiment.tags.map(tag => (
                              <li key={tag} className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[9px] uppercase tracking-wide text-white/35">
                                {tag}
                              </li>
                            ))}
                          </ul>
                        )}

                        <button
                          type="button"
                          onClick={() => onLoad(experiment)}
                          className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-4 text-[10px] font-bold uppercase tracking-[0.15em] text-white/70 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                        >
                          Load experiment
                          <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-5 py-12 text-center">
                  <FlaskConical size={24} className="mx-auto text-white/20" aria-hidden="true" />
                  <p className="mt-3 text-sm text-white/55">No prepared experiments yet.</p>
                  <p className="mt-1 text-xs text-white/30">Surprise Me can still build a fresh setup.</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
