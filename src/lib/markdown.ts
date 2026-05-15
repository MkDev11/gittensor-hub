// GitHub-flavored markdown renderer for issue/PR bodies.
// Uses `marked` (CommonMark + GFM) and DOMPurify for sanitization.
// Output is styled by .md-content rules in globals.css to match github.com.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  // GitHub does NOT convert single newlines inside paragraphs to <br/>.
  breaks: false,
});

const SANITIZE_OPTS = {
  ADD_ATTR: ['target', 'rel'],
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
};

// Open every rendered link in a new tab with safe rel attributes.
// Done as a post-process so we don't have to override marked's renderer
// (which would lose its internal `this` context for parseInline).
function openLinksInNewTab(html: string): string {
  return html.replace(/<a (?![^>]*\btarget=)/g, '<a target="_blank" rel="noreferrer noopener" ');
}

// LRU cache so re-opening the same issue/PR (or a viewer re-render with the
// same body string) doesn't re-parse + re-sanitize. ContentViewer can blast
// through the same body 10+ times during a single open as TanStack Query
// settles its cache, so even a small cache pays for itself.
const MARKDOWN_CACHE_LIMIT = 256;
const markdownCache = new Map<string, string>();
function memoizedRender(key: string, build: () => string): string {
  const hit = markdownCache.get(key);
  if (hit !== undefined) {
    // Re-insert at the tail so it's marked recently-used.
    markdownCache.delete(key);
    markdownCache.set(key, hit);
    return hit;
  }
  const value = build();
  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) {
    const oldest = markdownCache.keys().next().value;
    if (oldest !== undefined) markdownCache.delete(oldest);
  }
  markdownCache.set(key, value);
  return value;
}

export function renderMarkdownToHtml(input: string): string {
  if (!input) return '';
  const isClient = typeof window !== 'undefined';
  // Cache per-environment so the unsanitized SSR output never leaks into a
  // later client-side call.
  const cacheKey = (isClient ? 'c:' : 's:') + input;
  return memoizedRender(cacheKey, () => {
    const raw = openLinksInNewTab(marked.parse(input, { async: false }) as string);
    if (!isClient) return raw;
    return DOMPurify.sanitize(raw, SANITIZE_OPTS);
  });
}

// Some submissions are pasted from an issue-generator template:
//
//   **Body:**
//   ```markdown
//   ...actual GitHub issue body...
//   ```
//
// github.com renders the actual submitted body, not the outer generator
// wrapper. Extracting the inner markdown keeps the dashboard view aligned
// with what users expect to inspect on GitHub.
export function normalizeGitHubBodyMarkdown(input: string): string {
  const bodyBlock = input.match(/(?:^|\n)\*\*Body:\*\*\s*\n+```(?:markdown|md)?[^\n]*\n([\s\S]*?)\n```/i);
  if (bodyBlock?.[1]) return bodyBlock[1].trim();

  const wholeFence = input.match(/^```(?:markdown|md)?[^\n]*\n([\s\S]*?)\n```\s*$/i);
  if (wholeFence?.[1]) return wholeFence[1].trim();

  return input;
}
