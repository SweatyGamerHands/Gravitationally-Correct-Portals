import { useId, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Info } from 'lucide-react';

export type HelpTooltipProps = {
  text: string;
  label?: string;
  className?: string;
};

export const HelpTooltip = ({
  text,
  label = 'More information',
  className = '',
}: HelpTooltipProps) => {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const show = hovered || focused || pinned;

  return (
    <span
      className={`relative ml-1 inline-flex items-center ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={show ? tooltipId : undefined}
        aria-expanded={show}
        onClick={(event) => {
          event.stopPropagation();
          setPinned(current => !current);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setPinned(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setPinned(false);
            setFocused(false);
            event.currentTarget.blur();
          }
        }}
        className="-m-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full p-1 text-white/30 transition-colors hover:bg-white/5 hover:text-[#00a2ff] focus-visible:text-[#00a2ff]"
      >
        <Info size={13} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {show && (
          <motion.span
            id={tooltipId}
            role="tooltip"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="pointer-events-none absolute bottom-full left-1/2 z-[1000] mb-2.5 w-48 max-w-[min(16rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-white/15 bg-[#08080d]/95 p-3 text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-white/80 shadow-2xl ring-1 ring-black/40 backdrop-blur-xl md:w-56"
          >
            {text}
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-full -translate-x-1/2 border-[7px] border-transparent border-t-[#08080d]/95"
            />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
};
