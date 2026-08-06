// Minimal markdown renderer for assistant text and markdown cards.
//
// Deliberately not a full parser — a chat message or card body is short, and
// pulling in a markdown library plus a sanitizer for this is disproportionate.
// Everything is escaped first, so model output cannot inject markup.
export function renderMarkdown(src: string): string {
  // Quotes are escaped because link URLs are interpolated into href="…" — an
  // unescaped quote in a URL would close the attribute and open a new one
  // (browsers recover from the missing-whitespace parse error by reading
  // `"onmouseover="…` as a fresh attribute).
  const escaped = src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Fenced code blocks are pulled out into placeholders before any other
  // transform runs, so bold/italic/list/paragraph rules never reach into code
  // content (e.g. "**not bold**" inside a fence must stay literal). The
  // placeholder starts with "<" so the paragraph pass below — which only wraps
  // blocks that don't already look like markup — leaves it alone.
  const fences: string[] = [];
  const withoutFences = escaped.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, body: string) => {
    const i = fences.push(body.replace(/\n$/, "")) - 1;
    return `<!--sc-fence-${i}-->`;
  });

  const html = withoutFences
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    // Only http(s) links — a javascript: URL must never survive.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/^[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, "<ul>$1</ul>")
    .split(/\n{2,}/)
    .map((block) => (block.trim().startsWith("<") ? block : `<p>${block.replace(/\n/g, "<br/>")}</p>`))
    .join("");

  // Restore fences last, as <pre><code> — the body is already HTML-escaped
  // from the pass above, and untouched by anything run in between.
  return html.replace(/<!--sc-fence-(\d+)-->/g, (_m, i: string) => `<pre><code>${fences[Number(i)]}</code></pre>`);
}
