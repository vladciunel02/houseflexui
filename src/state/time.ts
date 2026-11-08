import { useSyncExternalStore } from 'react';

// Global simulated clock, in minutes since 00:00. Shared by both views.
let minute = 12 * 60 + 30;
const listeners = new Set<() => void>();

export const timeStore = {
  get: () => minute,
  set: (m: number) => {
    const next = ((m % 1440) + 1440) % 1440;
    if (next === minute) return;
    minute = next;
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useMinute(): number {
  return useSyncExternalStore(timeStore.subscribe, timeStore.get);
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
