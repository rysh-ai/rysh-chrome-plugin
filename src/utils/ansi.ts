// ANSI-to-HTML converter — copied verbatim from internal/web/frontend/src/utils/ansi.ts

const ANSI_COLORS_16 = [
  '#000000', '#aa0000', '#00aa00', '#aa5500', '#0000aa', '#aa00aa', '#00aaaa', '#aaaaaa',
  '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff',
];

function xterm256ToHex(n: number): string {
  if (n < 16) return ANSI_COLORS_16[n];
  if (n < 232) {
    n -= 16;
    const r = Math.floor(n / 36) * 51;
    const g = Math.floor((n % 36) / 6) * 51;
    const b = (n % 6) * 51;
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }
  const v = 8 + (n - 232) * 10;
  return '#' + [v, v, v].map(c => c.toString(16).padStart(2, '0')).join('');
}

export function ansiToHtml(text: string): string {
  if (!text) return '';
  let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let result = '';
  let fg: string | null = null;
  let bg: string | null = null;
  let bold = false, dim = false, italic = false, underline = false, reverse = false, strikethrough = false;
  let openSpan = false;

  function emitSpan() {
    if (openSpan) { result += '</span>'; openSpan = false; }
    const styles: string[] = [];
    const classes: string[] = [];
    let eFg = fg, eBg = bg;
    if (reverse) { [eFg, eBg] = [eBg || '#1e1e1e', eFg || '#d4d4d4']; }
    if (eFg) styles.push('color:' + eFg);
    if (eBg) styles.push('background:' + eBg);
    if (bold) classes.push('ansi-bold');
    if (dim) classes.push('ansi-dim');
    if (italic) classes.push('ansi-italic');
    if (underline) classes.push('ansi-underline');
    if (strikethrough) classes.push('ansi-strikethrough');
    if (styles.length || classes.length) {
      result += '<span';
      if (classes.length) result += ' class="' + classes.join(' ') + '"';
      if (styles.length) result += ' style="' + styles.join(';') + '"';
      result += '>';
      openSpan = true;
    }
  }

  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(html)) !== null) {
    if (match.index > lastIndex) result += html.substring(lastIndex, match.index);
    lastIndex = match.index + match[0].length;

    const params = match[1] ? match[1].split(';').map(Number) : [0];
    let i = 0;
    while (i < params.length) {
      const p = params[i];
      if (p === 0) {
        if (openSpan) { result += '</span>'; openSpan = false; }
        fg = bg = null; bold = dim = italic = underline = reverse = strikethrough = false;
      } else if (p === 1) { bold = true; emitSpan(); }
      else if (p === 2) { dim = true; emitSpan(); }
      else if (p === 3) { italic = true; emitSpan(); }
      else if (p === 4) { underline = true; emitSpan(); }
      else if (p === 7) { reverse = true; emitSpan(); }
      else if (p === 9) { strikethrough = true; emitSpan(); }
      else if (p === 22) { bold = false; dim = false; emitSpan(); }
      else if (p === 23) { italic = false; emitSpan(); }
      else if (p === 24) { underline = false; emitSpan(); }
      else if (p === 27) { reverse = false; emitSpan(); }
      else if (p === 29) { strikethrough = false; emitSpan(); }
      else if (p >= 30 && p <= 37) { fg = ANSI_COLORS_16[p - 30]; emitSpan(); }
      else if (p === 38) {
        if (params[i + 1] === 5 && i + 2 < params.length) { fg = xterm256ToHex(params[i + 2]); i += 2; emitSpan(); }
        else if (params[i + 1] === 2 && i + 4 < params.length) {
          fg = '#' + [params[i + 2], params[i + 3], params[i + 4]].map(c => c.toString(16).padStart(2, '0')).join('');
          i += 4; emitSpan();
        }
      }
      else if (p === 39) { fg = null; emitSpan(); }
      else if (p >= 40 && p <= 47) { bg = ANSI_COLORS_16[p - 40]; emitSpan(); }
      else if (p === 48) {
        if (params[i + 1] === 5 && i + 2 < params.length) { bg = xterm256ToHex(params[i + 2]); i += 2; emitSpan(); }
        else if (params[i + 1] === 2 && i + 4 < params.length) {
          bg = '#' + [params[i + 2], params[i + 3], params[i + 4]].map(c => c.toString(16).padStart(2, '0')).join('');
          i += 4; emitSpan();
        }
      }
      else if (p === 49) { bg = null; emitSpan(); }
      else if (p >= 90 && p <= 97) { fg = ANSI_COLORS_16[p - 90 + 8]; emitSpan(); }
      else if (p >= 100 && p <= 107) { bg = ANSI_COLORS_16[p - 100 + 8]; emitSpan(); }
      i++;
    }
  }

  if (lastIndex < html.length) result += html.substring(lastIndex);
  if (openSpan) result += '</span>';

  // Strip unhandled escape sequences.
  result = result.replace(/\x1b\[[0-9;]*[A-HJKSTfhln]/g, '');
  result = result.replace(/\x1b\][^\x07]*\x07/g, '');
  result = result.replace(/\x1b\[[?][0-9;]*[hlr]/g, '');
  result = result.replace(/\x1b[()][012AB]/g, '');
  result = result.replace(/\x1b=/g, '');
  result = result.replace(/\r/g, '');

  return result;
}

/**
 * Build HTML from raw terminal output.
 * Lines starting with \x02 are right-aligned prompt echo lines.
 */
export function buildOutputHtml(text: string): string {
  return text
    .split('\n')
    .map(line => {
      if (line.startsWith('\x02')) {
        return '<div style="text-align:right;color:#5fafff;font-weight:bold">' + ansiToHtml(line.substring(1)) + '</div>';
      }
      return ansiToHtml(line);
    })
    .join('\n');
}

/** Render markdown-like text to safe HTML (used in chat bubbles). */
export function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Fenced code blocks.
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) =>
    `<pre><code>${code.trim()}</code></pre>`,
  );
  // Inline code.
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold.
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic.
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Lists.
  html = html.replace(/^[ \t]*[-*+] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  // Paragraphs.
  html = html.replace(/\n\n+/g, '</p><p>');
  // Single newlines.
  html = html.replace(/\n/g, '<br>');

  return `<p>${html}</p>`;
}
