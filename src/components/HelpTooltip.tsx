import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Info } from 'lucide-react';

export const HelpTooltip = ({ text }: { text: string }) => {
  const [show, setShow] = useState(false);
  return <div className="relative inline-flex items-center ml-1"><button tabIndex={-1} onClick={(e) => { e.stopPropagation(); setShow(!show); }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} className="p-1 -m-1 text-white/20 hover:text-[#00a2ff] transition-colors focus:outline-none"><Info size={12} /></button><AnimatePresence>{show && <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 md:w-56 bg-black/95 backdrop-blur-xl border border-white/20 p-2.5 rounded-xl text-[9px] md:text-[11px] text-white leading-relaxed pointer-events-none z-[1000] shadow-2xl ring-1 ring-white/10">{text}<div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-black/95"></div></motion.div>}</AnimatePresence></div>;
};
