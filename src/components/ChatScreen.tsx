import React, { useEffect } from 'react';
import { useStore } from '../store';
import { apiService } from '../services/api';
import { useKeyboard } from '../hooks/useKeyboard';
import Header from './Header';
import PaneOutput from './PaneOutput';
import PaneInput from './PaneInput';
import ErrorBanner from './ErrorBanner';
import ApprovalDialog from './ApprovalDialog';
import DebugOverlay from './DebugOverlay';

/**
 * ChatScreen — the main pane view.
 *
 * Wires up apiService event handlers into the Zustand store and renders:
 *   Header → PaneOutput → ErrorBanner → PaneInput
 */
export default function ChatScreen() {
  useKeyboard();

  useEffect(() => {
    // ── AI/prompt output (streaming chunks) ──────────────────────────────────
    const offOutput = apiService.onOutput(({ type, content }) => {
      const store = useStore.getState();

      if (type === 'error') {
        store.setErrorMessage(content || 'An error occurred.');
        store.setIsLoading(false);
        store.finalizeStreaming();
        return;
      }

      if (!content) return;

      // Remote user prompt from a CLI share command — show as a user bubble.
      if (type === 'user_prompt') {
        if (store.inputMode !== 'prompt') {
          store.setInputMode('prompt');
        }
        store.addMessage({
          id:        crypto.randomUUID(),
          role:      'user',
          content,
          timestamp: new Date(),
          mode:      'prompt',
        });
        store.setIsLoading(true);
        return;
      }

      if (type === 'text' || type === 'diff') {
        // AI streaming text always belongs to 'prompt' mode, regardless of
        // the current input mode.  Auto-switch to prompt so the user sees it.
        const aiMode = 'prompt' as const;
        if (store.inputMode !== 'prompt') {
          store.setInputMode('prompt');
        }
        if (store.streamingContent === null) {
          store.startStreaming(aiMode);
        }
        store.appendStreaming(content);
      } else if (type === 'tool_call') {
        store.addMessage({
          id:        crypto.randomUUID(),
          role:      'tool',
          content:   '▶ ' + content,
          timestamp: new Date(),
          mode:      'prompt',
        });
      } else if (type === 'tool_result') {
        store.addMessage({
          id:        crypto.randomUUID(),
          role:      'tool',
          content:   '✓ ' + content,
          timestamp: new Date(),
          mode:      'prompt',
        });
      } else if (type === 'shell') {
        store.appendShellOutput(content);
      } else if (type === 'rysh') {
        store.appendRyshOutput(content);
      } else if (type === 'chat') {
        store.appendChatOutput(content);
      }
    });

    // ── Agentic phase status ──────────────────────────────────────────────────
    const offStatus = apiService.onStatus(({ phase, iteration, maxIterations }) => {
      const store = useStore.getState();
      if (phase === 'done' || phase === 'error') {
        store.finalizeStreaming();
        store.setIsLoading(false);
        store.setStatusText('');
        if (phase === 'error') {
          store.setErrorMessage('The agentic run ended with an error.');
        }
      } else {
        // Auto-switch to prompt mode when AI starts working.
        if (store.inputMode !== 'prompt') {
          store.setInputMode('prompt');
        }
        let label = phase.charAt(0).toUpperCase() + phase.slice(1) + '…';
        if (iteration > 0 && maxIterations > 0) {
          label += ` (${iteration}/${maxIterations})`;
        }
        store.setStatusText(label);
        store.setIsLoading(true);
      }
    });

    // ── Approval requests ─────────────────────────────────────────────────────
    const offApproval = apiService.onApproval(approval => {
      useStore.getState().setPendingApproval(approval);
    });

    // ── Connection state ──────────────────────────────────────────────────────
    const offConnect    = apiService.onConnect(()    => useStore.getState().setConnected(true));
    const offDisconnect = apiService.onDisconnect(() => useStore.getState().setConnected(false));

    return () => {
      offOutput();
      offStatus();
      offApproval();
      offConnect();
      offDisconnect();
    };
  }, []);

  return (
    <div className="flex flex-col w-full h-full bg-bg overflow-hidden">
      <Header />
      <PaneOutput />
      <ErrorBanner />
      <ApprovalDialog />
      <PaneInput />
      {/* Keyboard hint */}
      <div className="text-[10px] text-dim text-center py-1 bg-surface border-t border-border shrink-0 select-none">
        Enter to send &nbsp;·&nbsp; Double-Esc to cycle modes
      </div>
      <DebugOverlay />
    </div>
  );
}
