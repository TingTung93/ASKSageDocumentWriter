// Tiny toast notification store. Components fire `toast.success("Saved")`
// or `toast.error(message)` and the global <ToastContainer /> renders them
// in the corner. Auto-dismiss after 3 seconds unless `sticky` is set.

import { create } from 'zustand';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  message: string;
  sticky?: boolean;
}

interface ToastState {
  toasts: ToastEntry[];
  push: (kind: ToastKind, message: string, sticky?: boolean) => void;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, sticky) => {
    const id = nextId++;
    set({ toasts: [...get().toasts, { id, kind, message, sticky }] });
    if (!sticky) {
      setTimeout(() => get().dismiss(id), 3000);
    }
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  clear: () => set({ toasts: [] }),
}));

/** Convenience helpers so callers don't have to grab the hook each time. */
export const toast = {
  success: (msg: string) => useToasts.getState().push('success', msg),
  error: (msg: string) => useToasts.getState().push('error', msg),
  info: (msg: string) => useToasts.getState().push('info', msg),
  sticky: (kind: ToastKind, msg: string) => useToasts.getState().push(kind, msg, true),
};
