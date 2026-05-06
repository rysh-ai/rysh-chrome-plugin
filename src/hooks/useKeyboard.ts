// useKeyboard.ts — Global keyboard handler.
// Implements double-ESC mode cycling (mirrors internal/web/frontend/src/hooks/useKeyboard.ts).

import { useEffect } from 'react';
import { useStore } from '../store';

export function useKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const store = useStore.getState();

      // ── Escape: double-ESC cycles input mode ──────────────────────────────
      if (e.key === 'Escape') {
        // Don't intercept ESC when approval dialog is open (it has its own handler).
        if (store.pendingApproval) return;

        // Don't intercept ESC when the user is typing in a non-input context
        // (e.g. inside a modal text input).
        const tag = (document.activeElement as HTMLElement | null)?.tagName;
        if (tag === 'TEXTAREA') return;

        e.preventDefault();

        clearTimeout(store.escTimer ?? undefined);
        const newCount = store.escCount + 1;

        if (newCount >= 2) {
          store.setEscCount(0);
          store.cycleInputMode();
          return;
        }

        store.setEscCount(newCount);
        store.setEscTimer(
          setTimeout(() => {
            useStore.getState().setEscCount(0);
          }, 400), // 400ms window — same as web terminal
        );
      } else {
        // Any non-ESC key resets the ESC counter.
        if (store.escCount > 0) {
          clearTimeout(store.escTimer ?? undefined);
          store.setEscCount(0);
          store.setEscTimer(null);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
