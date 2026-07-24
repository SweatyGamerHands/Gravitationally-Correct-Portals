import { useEffect, useId, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, FlaskConical, X } from 'lucide-react';

export type TheoryOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const canonicalAssumptions = [
  {
    title: 'Linked geometry',
    body: 'Each complete pair joins corresponding aperture coordinates. Tangential position is preserved and the through-plane normal is reversed.',
  },
  {
    title: 'Matter traversal',
    body: 'A body traverses only when its full radius clears both solid rims. One-sided mouths add a solid rear plate; two-sided mouths accept either approach.',
  },
  {
    title: 'Gravity coupling',
    body: 'Linked mouths participate in one reciprocal scalar-potential field. Matter sidedness never makes gravity one-way.',
  },
  {
    title: 'Velocity and energy',
    body: 'Fixed passive mouths map velocity without changing speed. A moving mouth may exchange energy through the external actuator that moves its frame.',
  },
  {
    title: 'Body model',
    body: 'Objects are circular bodies with whole-body traversal. Partial slices are rendered at the seam, but split rigid-body dynamics are not simulated.',
  },
];

const speculativeAssumptions = [
  'Gravity sourced by bodies and recursively transmitted through apertures',
  'Reaction forces, finite-mass frames, and freely moving portal hardware',
  'One-to-many routing or manually linked portal networks',
  'Finite-speed gravitational propagation and causal-delay experiments',
  'Rigid bodies simultaneously spanning two frames and force environments',
];

export function TheoryOverlay({ open, onClose }: TheoryOverlayProps) {
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

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )) as HTMLElement[];
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-xl md:p-6"
          onPointerDown={(event) => {
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
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="lab-scroll-area relative max-h-[min(90vh,54rem)] w-full max-w-4xl overflow-y-auto rounded-[24px] border border-white/10 bg-[#0a0a0f] shadow-2xl ring-1 ring-black/50 md:rounded-[34px]"
          >
            <header className="sticky top-0 z-10 border-b border-white/10 bg-[#0a0a0f]/95 px-5 py-5 backdrop-blur-xl md:px-8 md:py-7">
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Close physics assumptions"
                className="absolute right-4 top-4 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/50 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white md:right-6 md:top-6"
              >
                <X size={18} aria-hidden="true" />
              </button>

              <div className="pr-14">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#00a2ff]">
                  Model contract
                </div>
                <h2 id={titleId} className="text-2xl font-light text-white md:text-3xl">
                  Physics assumptions
                </h2>
                <p id={descriptionId} className="mt-2 max-w-2xl text-xs leading-relaxed text-white/45 md:text-sm">
                  Portals are hypothetical. This laboratory treats accuracy as internal consistency with an explicit, testable set of rules.
                </p>
              </div>
            </header>

            <div className="grid gap-5 p-5 md:grid-cols-[1.2fr_0.8fr] md:gap-6 md:p-8">
              <section aria-labelledby={`${titleId}-canonical`} className="rounded-2xl border border-[#00a2ff]/20 bg-[#00a2ff]/5 p-4 md:p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-[#00a2ff]">
                      <Check size={15} aria-hidden="true" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Active default</span>
                    </div>
                    <h3 id={`${titleId}-canonical`} className="text-lg font-semibold text-white">
                      Canonical laboratory model
                    </h3>
                  </div>
                  <span className="rounded-full border border-[#00a2ff]/30 bg-[#00a2ff]/10 px-2.5 py-1 text-[9px] font-mono uppercase tracking-wider text-[#00a2ff]">
                    Canonical
                  </span>
                </div>

                <div className="space-y-4">
                  {canonicalAssumptions.map((assumption, index) => (
                    <article key={assumption.title} className="grid grid-cols-[1.5rem_1fr] gap-3">
                      <div className="pt-0.5 font-mono text-[10px] text-[#00a2ff]/70">
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-white/90">{assumption.title}</h4>
                        <p className="mt-1 text-[11px] leading-relaxed text-white/45 md:text-xs">{assumption.body}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section aria-labelledby={`${titleId}-speculative`} className="rounded-2xl border border-[#ff9d00]/20 bg-[#ff9d00]/5 p-4 md:p-6">
                <div className="mb-5 flex items-center gap-2 text-[#ff9d00]">
                  <FlaskConical size={15} aria-hidden="true" />
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em]">Not active by default</div>
                    <h3 id={`${titleId}-speculative`} className="mt-1 text-lg font-semibold text-white">
                      Speculative extensions
                    </h3>
                  </div>
                </div>

                <p className="mb-5 text-[11px] leading-relaxed text-white/45 md:text-xs">
                  These are valid questions for future experiments, but they require new declared rules. They should never silently alter canonical results.
                </p>

                <ul className="space-y-3">
                  {speculativeAssumptions.map(assumption => (
                    <li key={assumption} className="flex gap-3 text-[11px] leading-relaxed text-white/55 md:text-xs">
                      <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff9d00]/70" />
                      <span>{assumption}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 rounded-xl border border-white/10 bg-black/20 p-3 text-[10px] leading-relaxed text-white/35">
                  Experimental modes should be named, visually badged, and included in saved experiment data.
                </div>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
