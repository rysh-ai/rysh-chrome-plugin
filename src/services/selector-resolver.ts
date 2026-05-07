// selector-resolver.ts — Content script injected into pages to provide the
// unified __rysh_resolve_selector function for browser actions.

/**
 * Inject the __rysh_resolve_selector function into the given tab's main world.
 * The function supports multiple selector strategies:
 *   - CSS selector (default): "#login-button", ".submit-btn"
 *   - XPath: "xpath:..." or "//" prefix
 *   - Text match: "text:..." (finds element containing text)
 *   - ARIA label: "aria:..." (matches aria-label)
 *   - Role: "role:..." (matches role attribute)
 *   - Test ID: "testid:..." (matches data-testid)
 */
export async function injectSelectorResolver(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Skip if already injected.
        if ((window as any).__rysh_resolve_selector) return;

        (window as any).__rysh_resolve_selector = (
          selector: string,
          text?: string,
          index: number = 0,
        ): Element | null => {
          let candidates: Element[] = [];

          if (selector.startsWith('xpath:') || selector.startsWith('//')) {
            // XPath resolution
            const xpath = selector.startsWith('xpath:') ? selector.slice(6) : selector;
            const result = document.evaluate(
              xpath, document, null,
              XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null,
            );
            for (let i = 0; i < result.snapshotLength; i++) {
              const node = result.snapshotItem(i);
              if (node instanceof Element) candidates.push(node);
            }

          } else if (selector.startsWith('text:')) {
            // Text content match — find the most specific (deepest) element
            const searchText = selector.slice(5).toLowerCase();
            const all = document.querySelectorAll('*');
            const matches: Element[] = [];
            all.forEach(el => {
              const directText = Array.from(el.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent || '')
                .join('');
              if (directText.toLowerCase().includes(searchText)) {
                matches.push(el);
              }
            });
            // If no direct text matches, fall back to textContent match
            if (matches.length === 0) {
              all.forEach(el => {
                if (el.textContent?.toLowerCase().includes(searchText)) {
                  matches.push(el);
                }
              });
              // Sort by textContent length (prefer most specific)
              matches.sort((a, b) =>
                (a.textContent?.length || 0) - (b.textContent?.length || 0),
              );
            }
            candidates = matches;

          } else if (selector.startsWith('aria:')) {
            const label = selector.slice(5);
            candidates = Array.from(
              document.querySelectorAll(`[aria-label="${CSS.escape(label)}"], [aria-labelledby="${CSS.escape(label)}"]`),
            );

          } else if (selector.startsWith('role:')) {
            const role = selector.slice(5);
            candidates = Array.from(document.querySelectorAll(`[role="${CSS.escape(role)}"]`));

          } else if (selector.startsWith('testid:')) {
            const testid = selector.slice(7);
            candidates = Array.from(document.querySelectorAll(`[data-testid="${CSS.escape(testid)}"]`));

          } else {
            // CSS selector (default)
            try {
              candidates = Array.from(document.querySelectorAll(selector));
            } catch {
              return null;
            }
          }

          // Filter by text content if provided
          if (text) {
            const lowerText = text.toLowerCase();
            candidates = candidates.filter(el =>
              el.textContent?.toLowerCase().includes(lowerText),
            );
          }

          // Prefer visible elements
          const visible = candidates.filter(el => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

          const pool = visible.length > 0 ? visible : candidates;
          return pool[index] ?? null;
        };
      },
      world: 'MAIN',
    });
  } catch {
    // Script injection may fail on protected pages — silently ignore
  }
}
