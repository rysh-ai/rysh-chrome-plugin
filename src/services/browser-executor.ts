// browser-executor.ts — Executes browser actions requested by the server-side
// AI agent. Each action is performed using Chrome extension APIs (scripting,
// tabs, etc.) and returns a structured result.

import { injectSelectorResolver } from './selector-resolver';
import { debugLog } from './debug-log';

export interface BrowserActionRequest {
  request_id: string;
  action: string;
  params: Record<string, any>;
}

export interface BrowserActionResult {
  request_id: string;
  success: boolean;
  result?: any;
  error?: string;
  screenshot?: string; // base64 PNG
}

const PROTECTED_PREFIXES = ['chrome://', 'chrome-extension://', 'about:', 'devtools://'];

function isProtectedUrl(url: string): boolean {
  return PROTECTED_PREFIXES.some(prefix => url.startsWith(prefix));
}

export class BrowserActionExecutor {
  /**
   * Dispatch an action request to the appropriate handler.
   */
  async execute(req: BrowserActionRequest): Promise<BrowserActionResult> {
    debugLog(`browser-executor: ${req.action} ${JSON.stringify(req.params).slice(0, 100)}`);
    try {
      const handler = this.getHandler(req.action);
      if (!handler) {
        return { request_id: req.request_id, success: false, error: `Unknown action: ${req.action}` };
      }

      // Inject selector resolver for element-targeting actions.
      const needsResolver = [
        'click', 'type', 'select', 'check', 'hover', 'get_text', 'get_html',
        'get_elements', 'get_value', 'scroll', 'press_key', 'drag_drop', 'wait',
      ];
      if (needsResolver.includes(req.action)) {
        const tab = await this.getActiveTab();
        if (tab?.id && !isProtectedUrl(tab.url || '')) {
          await injectSelectorResolver(tab.id);
        }
      }

      const result = await handler(req.params);
      return { request_id: req.request_id, success: true, result };
    } catch (err: any) {
      const msg = err?.message || String(err);
      debugLog(`browser-executor error: ${msg}`);
      return { request_id: req.request_id, success: false, error: msg };
    }
  }

  private getHandler(action: string): ((params: any) => Promise<any>) | null {
    const handlers: Record<string, (params: any) => Promise<any>> = {
      navigate:     this.navigate.bind(this),
      click:        this.click.bind(this),
      type:         this.typeText.bind(this),
      select:       this.selectOption.bind(this),
      check:        this.check.bind(this),
      scroll:       this.scroll.bind(this),
      hover:        this.hover.bind(this),
      wait:         this.waitFor.bind(this),
      screenshot:   this.screenshot.bind(this),
      get_text:     this.getText.bind(this),
      get_html:     this.getHtml.bind(this),
      get_elements: this.getElements.bind(this),
      get_value:    this.getValue.bind(this),
      get_tabs:     this.getTabs.bind(this),
      switch_tab:   this.switchTab.bind(this),
      new_tab:      this.newTab.bind(this),
      close_tab:    this.closeTab.bind(this),
      back:         this.back.bind(this),
      forward:      this.forward.bind(this),
      reload:       this.reload.bind(this),
      execute_js:   this.executeJs.bind(this),
      press_key:    this.pressKey.bind(this),
      drag_drop:    this.dragDrop.bind(this),
    };
    return handlers[action] || null;
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  private async navigate(params: { url: string }): Promise<any> {
    if (!params.url) return { error: 'Missing required parameter: url' };
    const tab = await this.getActiveTab();
    await chrome.tabs.update(tab.id!, { url: params.url });
    await this.waitForTabLoad(tab.id!);
    const updated = await chrome.tabs.get(tab.id!);
    return { url: updated.url, title: updated.title };
  }

  private async back(): Promise<any> {
    const tab = await this.getActiveTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: () => window.history.back(),
    });
    await this.sleep(500);
    return { status: 'navigated_back' };
  }

  private async forward(): Promise<any> {
    const tab = await this.getActiveTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: () => window.history.forward(),
    });
    await this.sleep(500);
    return { status: 'navigated_forward' };
  }

  private async reload(): Promise<any> {
    const tab = await this.getActiveTab();
    await chrome.tabs.reload(tab.id!);
    await this.waitForTabLoad(tab.id!);
    return { status: 'reloaded' };
  }

  // ── Element Interaction ───────────────────────────────────────────────────

  private async click(params: { selector: string; text?: string; index?: number }): Promise<any> {
    if (!params.selector) return { error: 'Missing required parameter: selector' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string, text: string | null, index: number) => {
        const resolve = (window as any).__rysh_resolve_selector;
        if (!resolve) return { error: 'Selector resolver not injected' };
        const el = resolve(selector, text, index);
        if (!el) return { error: `Element not found: ${selector}` };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.click();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().substring(0, 200),
          clicked: true,
        };
      },
      args: [params.selector, params.text ?? null, params.index ?? 0],
    });
    return results[0]?.result;
  }

  private async typeText(params: { selector: string; text: string; clear?: boolean }): Promise<any> {
    if (!params.selector) return { error: 'Missing required parameter: selector' };
    if (params.text === undefined) return { error: 'Missing required parameter: text' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string, text: string, clear: boolean) => {
        const resolve = (window as any).__rysh_resolve_selector;
        if (!resolve) return { error: 'Selector resolver not injected' };
        const el = resolve(selector) as HTMLInputElement | HTMLTextAreaElement;
        if (!el) return { error: `Element not found: ${selector}` };
        el.focus();
        if (clear) {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
        // Use native setter for React compatibility
        const nativeSetter =
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        const newValue = clear ? text : el.value + text;
        if (nativeSetter) {
          nativeSetter.call(el, newValue);
        } else {
          el.value = newValue;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { typed: text, selector, value: el.value };
      },
      args: [params.selector, params.text ?? '', params.clear ?? true],
    });
    return results[0]?.result;
  }

  private async selectOption(params: { selector: string; value?: string; text?: string }): Promise<any> {
    if (!params.selector) return { error: 'Missing required parameter: selector' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string, value: string | null, text: string | null) => {
        const resolve = (window as any).__rysh_resolve_selector;
        if (!resolve) return { error: 'Selector resolver not injected' };
        const el = resolve(selector) as HTMLSelectElement;
        if (!el) return { error: `Element not found: ${selector}` };
        const options = Array.from(el.options);
        const target = value
          ? options.find(o => o.value === value)
          : options.find(o => (o.textContent || '').trim() === text);
        if (!target) return { error: `Option not found: ${value || text}` };
        el.value = target.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { selected: target.value, text: (target.textContent || '').trim() };
      },
      args: [params.selector, params.value ?? null, params.text ?? null],
    });
    return results[0]?.result;
  }

  private async check(params: { selector: string; checked: boolean }): Promise<any> {
    if (!params.selector) return { error: 'Missing required parameter: selector' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string, checked: boolean) => {
        const resolve = (window as any).__rysh_resolve_selector;
        if (!resolve) return { error: 'Selector resolver not injected' };
        const el = resolve(selector) as HTMLInputElement;
        if (!el) return { error: `Element not found: ${selector}` };
        if (el.checked !== checked) el.click();
        return { checked: el.checked, selector };
      },
      args: [params.selector, params.checked ?? false],
    });
    return results[0]?.result;
  }

  private async hover(params: { selector: string }): Promise<any> {
    if (!params.selector) return { error: 'Missing required parameter: selector' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string) => {
        const resolve = (window as any).__rysh_resolve_selector;
        if (!resolve) return { error: 'Selector resolver not injected' };
        const el = resolve(selector);
        if (!el) return { error: `Element not found: ${selector}` };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        return { hovered: true, selector };
      },
      args: [params.selector],
    });
    return results[0]?.result;
  }

  private async pressKey(params: { key: string; modifiers?: string[] }): Promise<any> {
    if (!params.key) return { error: 'Missing required parameter: key' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (key: string, modifiers: string[]) => {
        const opts: KeyboardEventInit = {
          key, bubbles: true, cancelable: true,
          ctrlKey: modifiers.includes('ctrl'),
          shiftKey: modifiers.includes('shift'),
          altKey: modifiers.includes('alt'),
          metaKey: modifiers.includes('meta'),
        };
        const target = document.activeElement || document.body;
        target.dispatchEvent(new KeyboardEvent('keydown', opts));
        target.dispatchEvent(new KeyboardEvent('keypress', opts));
        target.dispatchEvent(new KeyboardEvent('keyup', opts));
        return { key, modifiers, sent: true };
      },
      args: [params.key ?? '', params.modifiers ?? []],
    });
    return results[0]?.result;
  }

  private async dragDrop(params: { from_selector: string; to_selector: string }): Promise<any> {
    if (!params.from_selector || !params.to_selector) {
      return { error: 'Missing required parameters: from_selector and to_selector' };
    }
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (fromSel: string, toSel: string) => {
        const from = document.querySelector(fromSel);
        const to = document.querySelector(toSel);
        if (!from || !to) return { error: 'Element not found' };
        const dataTransfer = new DataTransfer();
        from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        to.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }));
        to.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
        from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        return { dragged: fromSel, dropped: toSel };
      },
      args: [params.from_selector, params.to_selector],
    });
    return results[0]?.result;
  }

  // ── Scrolling ─────────────────────────────────────────────────────────────

  private async scroll(params: { direction: string; amount?: number; selector?: string }): Promise<any> {
    if (!params.direction) return { error: 'Missing required parameter: direction' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (direction: string, amount: number, selector: string | null) => {
        const target = selector ? document.querySelector(selector) : null;
        const scrollTarget = target || window;
        const px = amount || 500;
        const opts: ScrollToOptions = { behavior: 'smooth' };
        switch (direction) {
          case 'down':  (scrollTarget as any).scrollBy({ top: px, ...opts }); break;
          case 'up':    (scrollTarget as any).scrollBy({ top: -px, ...opts }); break;
          case 'right': (scrollTarget as any).scrollBy({ left: px, ...opts }); break;
          case 'left':  (scrollTarget as any).scrollBy({ left: -px, ...opts }); break;
        }
        return { scrolled: direction, amount: px };
      },
      args: [params.direction ?? 'down', params.amount ?? 500, params.selector ?? null],
    });
    return results[0]?.result;
  }

  // ── Waiting ───────────────────────────────────────────────────────────────

  private async waitFor(params: { selector?: string; timeout_ms?: number; visible?: boolean }): Promise<any> {
    const tab = await this.getActiveTab();
    const timeout = params.timeout_ms ?? 10000;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string | null, timeoutMs: number, needsVisible: boolean) => {
        return new Promise<any>((resolve) => {
          if (!selector) {
            // Wait for page idle
            if (document.readyState === 'complete') return resolve({ ready: true });
            window.addEventListener('load', () => resolve({ ready: true }));
            setTimeout(() => resolve({ ready: true, timeout: true }), timeoutMs);
            return;
          }
          const check = (): boolean => {
            const el = document.querySelector(selector!);
            if (!el) return false;
            if (needsVisible) {
              const rect = (el as HTMLElement).getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }
            return true;
          };
          if (check()) return resolve({ found: true, selector });
          const observer = new MutationObserver(() => {
            if (check()) {
              observer.disconnect();
              resolve({ found: true, selector });
            }
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          setTimeout(() => {
            observer.disconnect();
            resolve({ found: check(), selector, timeout: true });
          }, timeoutMs);
        });
      },
      args: [params.selector ?? null, timeout, params.visible ?? false],
    });
    return results[0]?.result;
  }

  // ── Content Extraction ────────────────────────────────────────────────────

  private async getText(params: { selector?: string }): Promise<any> {
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string | null) => {
        const el = selector ? document.querySelector(selector) : document.body;
        if (!el) return { error: `Element not found: ${selector}` };
        const text = (el.textContent || '').trim();
        return { text: text.substring(0, 50000), length: text.length, truncated: text.length > 50000 };
      },
      args: [params.selector ?? null],
    });
    return results[0]?.result;
  }

  private async getHtml(params: { selector?: string; outer?: boolean }): Promise<any> {
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string | null, outer: boolean) => {
        const el = selector ? document.querySelector(selector) : document.body;
        if (!el) return { error: `Element not found: ${selector}` };
        const html = outer ? el.outerHTML : el.innerHTML;
        return { html: html.substring(0, 50000), length: html.length, truncated: html.length > 50000 };
      },
      args: [params.selector ?? null, params.outer ?? false],
    });
    return results[0]?.result;
  }

  private async getElements(params: { selector: string; attributes?: string[]; limit?: number }): Promise<any> {
    if (!params.selector) return { error: 'Missing required parameter: selector' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string, attributes: string[], limit: number) => {
        let els: NodeListOf<Element>;
        try {
          els = document.querySelectorAll(selector);
        } catch {
          return { error: `Invalid selector: ${selector}` };
        }
        const items: any[] = [];
        const max = Math.min(els.length, limit);
        for (let i = 0; i < max; i++) {
          const el = els[i] as HTMLElement;
          const item: any = {
            index: i,
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().substring(0, 200),
            visible: el.offsetWidth > 0 && el.offsetHeight > 0,
          };
          if (el.id) item.id = el.id;
          if (el.className && typeof el.className === 'string') item.class = el.className;
          for (const attr of attributes) {
            const val = el.getAttribute(attr);
            if (val !== null) item[attr] = val;
          }
          items.push(item);
        }
        return { count: els.length, returned: items.length, elements: items };
      },
      args: [params.selector, params.attributes ?? [], params.limit ?? 50],
    });
    return results[0]?.result;
  }

  private async getValue(params: { selector: string }): Promise<any> {
    if (!params.selector) return { error: 'Missing required parameter: selector' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (selector: string) => {
        const el = document.querySelector(selector) as HTMLInputElement;
        if (!el) return { error: `Element not found: ${selector}` };
        return { value: el.value, type: el.type, tag: el.tagName.toLowerCase() };
      },
      args: [params.selector],
    });
    return results[0]?.result;
  }

  // ── Tab Management ────────────────────────────────────────────────────────

  private async getTabs(): Promise<any> {
    const tabs = await chrome.tabs.query({});
    return {
      tabs: tabs.map(t => ({
        id: t.id, index: t.index, title: t.title,
        url: t.url, active: t.active, windowId: t.windowId,
      })),
    };
  }

  private async switchTab(params: { tab_id?: number; index?: number; url_pattern?: string }): Promise<any> {
    let tab: chrome.tabs.Tab | undefined;
    if (params.tab_id) {
      tab = await chrome.tabs.get(params.tab_id);
    } else if (params.index !== undefined) {
      const tabs = await chrome.tabs.query({});
      tab = tabs[params.index];
    } else if (params.url_pattern) {
      const tabs = await chrome.tabs.query({ url: params.url_pattern });
      tab = tabs[0];
    } else {
      return { error: 'Provide tab_id, index, or url_pattern' };
    }
    if (!tab?.id) return { error: 'Tab not found' };
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return { tab_id: tab.id, title: tab.title, url: tab.url };
  }

  private async newTab(params: { url: string }): Promise<any> {
    if (!params.url) return { error: 'Missing required parameter: url' };
    const tab = await chrome.tabs.create({ url: params.url, active: true });
    await this.waitForTabLoad(tab.id!);
    const updated = await chrome.tabs.get(tab.id!);
    return { tab_id: updated.id, title: updated.title, url: updated.url };
  }

  private async closeTab(params: { tab_id?: number }): Promise<any> {
    const tabId = params.tab_id ?? (await this.getActiveTab()).id!;
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.remove(tabId);
    return { closed: tabId, title: tab.title };
  }

  // ── Screenshot ────────────────────────────────────────────────────────────

  private async screenshot(): Promise<any> {
    const tab = await this.getActiveTab();
    // Use JPEG at quality 40 to keep the payload under NATS's 1MB max.
    // A full-res PNG can be 2-3MB which exceeds the limit after base64 encoding.
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId!, { format: 'jpeg', quality: 40 });
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
    return {
      screenshot: base64,
      format: 'jpeg',
      tab_title: tab.title,
      tab_url: tab.url,
      note: 'Screenshot captured as base64 JPEG. The image data is in the screenshot field.',
    };
  }

  // ── JavaScript Execution ──────────────────────────────────────────────────

  private async executeJs(params: { code: string }): Promise<any> {
    if (!params.code) return { error: 'Missing required parameter: code' };
    const tab = await this.getActiveTab();
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: (code: string) => {
        try {
          // eslint-disable-next-line no-eval
          const result = eval(code);
          // Attempt to serialize; fall back to string representation
          try {
            JSON.stringify(result);
            return { result };
          } catch {
            return { result: String(result) };
          }
        } catch (e: any) {
          return { error: e.message || String(e) };
        }
      },
      args: [params.code],
    });
    return results[0]?.result;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getActiveTab(): Promise<chrome.tabs.Tab> {
    // Try lastFocusedWindow first (works better from side panels).
    const [lastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (lastFocused?.id) return lastFocused;
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current?.id) return current;
    throw new Error('No active tab found');
  }

  private waitForTabLoad(tabId: number, timeout = 15000): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeout);
      const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          // Small delay for JS execution after load event.
          setTimeout(resolve, 300);
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
