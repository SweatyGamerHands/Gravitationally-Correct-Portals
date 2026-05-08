import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

export function TheoryOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <AnimatePresence>{open && <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="fixed inset-0 flex items-center justify-center p-4 md:p-6 z-[100] bg-black/80 backdrop-blur-xl"><div className="max-w-2xl w-full bg-[#0a0a0f] border border-white/10 rounded-[24px] md:rounded-[40px] p-6 md:p-10 overflow-y-auto max-h-[85vh] shadow-2xl relative"><button onClick={onClose} className="absolute top-4 right-4 md:top-6 md:right-8 text-neutral-500 hover:text-white">Close</button><h2 className="text-2xl md:text-3xl font-serif italic text-white mb-6 md:mb-8 pr-12">Physics Architecture</h2></div></motion.div>}</AnimatePresence>;
}
