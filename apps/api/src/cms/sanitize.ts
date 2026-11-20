/**
 * Minimal allow-list HTML sanitiser for CMS rich text (regulator-authored, but still never trust
 * stored HTML). Strips scripts, event handlers, javascript: URLs and unknown tags.
 */
const ALLOWED = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'hr', 'span', 'div',
]);

export function sanitizeHtml(html: string | null | undefined): string | null {
  if (!html) return html ?? null;
  let out = html.replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, '');
  out = out.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (tag, name: string, attrs: string) => {
    const n = name.toLowerCase();
    if (!ALLOWED.has(n)) return '';
    if (tag.startsWith('</')) return `</${n}>`;
    const kept: string[] = [];
    for (const m of attrs.matchAll(/([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const a = m[1].toLowerCase();
      const v = (m[3] ?? m[4] ?? '').trim();
      if (a.startsWith('on')) continue;
      if ((a === 'href' || a === 'src') && /^\s*(javascript|data|vbscript):/i.test(v)) continue;
      if (['href', 'src', 'alt', 'title', 'target', 'colspan', 'rowspan'].includes(a)) kept.push(`${a}="${v.replace(/"/g, '&quot;')}"`);
    }
    if (n === 'a') kept.push('rel="noopener noreferrer"');
    return `<${n}${kept.length ? ' ' + kept.join(' ') : ''}>`;
  });
  return out;
}
