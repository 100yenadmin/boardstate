// Minimal, hand-rolled markdown → sanitized-HTML renderer for the markdown widget.
// Dependency free and allowlist-only: the raw source is HTML-escaped FIRST, then a
// fixed set of block/inline transforms emit ONLY these tags —
//   p, br, strong, em, code, pre, a[href=http(s)], ul, ol[start=integer], li, h1–h6,
//   blockquote,
//   plus a fixed task-list glyph span (never an <input> or other form control).
// Nothing else can reach the output, so the result is safe to inject with
// `unsafeHTML`. Links keep only absolute http(s) hrefs; any other scheme (or a
// relative/`javascript:` href) degrades to plain text.

/** HTML-escape the five significant characters. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** True for an absolute http(s) URL (the only href scheme links may carry). */
function isSafeHref(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** Apply inline markdown to an already-escaped line: code, links, bold, italic. */
function renderInline(escaped: string): string {
  let out = escaped;
  // Inline code first so its contents are not re-processed for emphasis.
  out = out.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`);
  // Links: [text](url) — only absolute http(s) urls survive as anchors.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text: string, url: string) =>
    isSafeHref(url) ? `<a href="${url}" rel="noopener noreferrer">${text}</a>` : match,
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, (_match, inner: string) => `<strong>${inner}</strong>`);
  out = out.replace(
    /(^|[^*])\*([^*]+)\*/g,
    (_m, lead: string, inner: string) => `${lead}<em>${inner}</em>`,
  );
  out = out.replace(
    /(^|[^_])_([^_]+)_/g,
    (_m, lead: string, inner: string) => `${lead}<em>${inner}</em>`,
  );
  return out;
}

/** An ATX heading line (CommonMark: the heading ends at the newline). */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;

/** Render one non-list block (blockquote / paragraph). */
function renderBlock(block: string): string {
  const lines = block.split("\n");
  if (lines.every((line) => line.startsWith(">"))) {
    const inner = lines
      .map((line) => renderInline(escapeHtml(line.replace(/^>\s?/, ""))))
      .join("<br>");
    return `<blockquote>${inner}</blockquote>`;
  }
  const body = lines.map((line) => renderInline(escapeHtml(line))).join("<br>");
  return `<p>${body}</p>`;
}

/** Render one list item; a GFM `[ ]` / `[x]` task marker becomes a glyph span. */
function renderListItem(item: string): string {
  const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
  if (!task) {
    return `<li>${renderInline(escapeHtml(item))}</li>`;
  }
  const checked = task[1] !== " ";
  const glyph = `<span class="dashboard-markdown__task" role="img" aria-label="${checked ? "checked" : "unchecked"}">${checked ? "☑" : "☐"}</span>`;
  return `<li class="dashboard-markdown__task-item">${glyph} ${renderInline(escapeHtml(task[2]!))}</li>`;
}

/** Render a bullet (`-`/`*`) or ordered (`1.`) list block. */
function renderList(block: string, ordered: boolean): string {
  const items = block
    .split("\n")
    .map((line) => line.replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, ""))
    .map(renderListItem)
    .join("");
  if (!ordered) {
    return `<ul>${items}</ul>`;
  }
  // Keep the author's numbering (e.g. a list split by a nested sub-list). The
  // attribute only ever carries a parsed integer, never source text.
  const start = Number.parseInt(/^\s*(\d+)\./.exec(block)?.[1] ?? "1", 10);
  return Number.isSafeInteger(start) && start !== 1
    ? `<ol start="${start}">${items}</ol>`
    : `<ol>${items}</ol>`;
}

function isUnorderedList(block: string): boolean {
  return block.split("\n").every((line) => /^\s*[-*]\s+/.test(line));
}

function isOrderedList(block: string): boolean {
  return block.split("\n").every((line) => /^\s*\d+\.\s+/.test(line));
}

/** Render a fenced code block (```) as escaped `<pre><code>`. */
function renderFence(lines: string[]): string {
  return `<pre><code>${escapeHtml(lines.join("\n"))}</code></pre>`;
}

/**
 * Convert a markdown source string into sanitized, allowlist-only HTML. Safe to
 * inject with `unsafeHTML`: every code path escapes text before wrapping it in one
 * of the permitted tags.
 */
export function toSanitizedMarkdownHtml(source: string): string {
  const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let paragraphKind = "";

  const flushParagraph = (): void => {
    if (paragraph.length === 0) {
      return;
    }
    const block = paragraph.join("\n");
    if (isUnorderedList(block)) {
      html.push(renderList(block, false));
    } else if (isOrderedList(block)) {
      html.push(renderList(block, true));
    } else {
      html.push(renderBlock(block));
    }
    paragraph = [];
  };

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]!;
    if (line.startsWith("```")) {
      flushParagraph();
      const fence: string[] = [];
      i += 1;
      while (i < rawLines.length && !rawLines[i]!.startsWith("```")) {
        fence.push(rawLines[i]!);
        i += 1;
      }
      html.push(renderFence(fence));
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1]!.length;
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2] ?? ""))}</h${level}>`);
      continue;
    }
    // A switch between bullet / ordered / plain lines starts a new block, so a
    // list directly under a heading or before trailing text still renders as a list.
    const kind = isUnorderedList(line) ? "ul" : isOrderedList(line) ? "ol" : "p";
    if (kind !== paragraphKind) {
      flushParagraph();
    }
    paragraphKind = kind;
    paragraph.push(line);
  }
  flushParagraph();
  return html.join("\n");
}
