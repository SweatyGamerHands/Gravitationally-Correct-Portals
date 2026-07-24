/**
 * Immutable undo/redo state. Entries are intentionally unbounded; callers own
 * the values and should treat committed values as immutable snapshots.
 */
export type HistoryState<T> = Readonly<{
  past: readonly T[];
  present: T;
  future: readonly T[];
}>;

export const createHistory = <T>(initial: T): HistoryState<T> => ({
  past: [],
  present: initial,
  future: [],
});

export const canUndoHistory = <T>(history: HistoryState<T>) => history.past.length > 0;

export const canRedoHistory = <T>(history: HistoryState<T>) => history.future.length > 0;

/** Commit a new value and discard any redo branch created by an earlier undo. */
export const commitHistory = <T>(
  history: HistoryState<T>,
  next: T,
  equals: (left: T, right: T) => boolean = Object.is,
): HistoryState<T> => {
  if (equals(history.present, next)) return history;

  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  };
};

export const undoHistory = <T>(history: HistoryState<T>): HistoryState<T> => {
  if (!canUndoHistory(history)) return history;

  const previousIndex = history.past.length - 1;
  return {
    past: history.past.slice(0, previousIndex),
    present: history.past[previousIndex],
    future: [history.present, ...history.future],
  };
};

export const redoHistory = <T>(history: HistoryState<T>): HistoryState<T> => {
  if (!canRedoHistory(history)) return history;

  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
};

/** Keep the current value while dropping all undo and redo entries. */
export const clearHistory = <T>(history: HistoryState<T>): HistoryState<T> => (
  createHistory(history.present)
);
