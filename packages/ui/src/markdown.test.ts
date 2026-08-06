import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("escapes HTML so model output cannot inject markup", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not linkify a javascript: URL", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('href="javascript');
  });

  it("cannot break out of the href attribute with a quote in the URL", () => {
    const html = renderMarkdown('[x](https://a.example/"onmouseover="location=name)');
    // The quote is entity-escaped, so it stays inside the href VALUE instead of
    // closing the attribute and smuggling in an onmouseover attribute.
    expect(html).toContain('href="https://a.example/&quot;onmouseover=&quot;location=name"');
    expect(html).not.toContain('/"onmouseover');
  });

  it("still linkifies an http(s) URL", () => {
    const html = renderMarkdown("[docs](https://example.com/page)");
    expect(html).toContain('<a href="https://example.com/page" target="_blank" rel="noopener noreferrer">docs</a>');
  });

  it("protects fenced code content from inline transforms", () => {
    const html = renderMarkdown("```\n**bold** and _stuff_ and [link](https://example.com)\n```");
    expect(html).toContain("<pre><code>**bold** and _stuff_ and [link](https://example.com)</code></pre>");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<a ");
  });

  it("does not paragraph-wrap or <br/>-ify fenced code content spanning multiple lines", () => {
    const html = renderMarkdown("```js\nline one\n\nline two\n```");
    expect(html).toContain("<pre><code>line one\n\nline two</code></pre>");
    expect(html).not.toContain("<br/>");
    expect(html).not.toContain("<p>line");
  });

  it("renders a basic paragraph and list", () => {
    const html = renderMarkdown("Hello world\n\n- one\n- two");
    expect(html).toContain("<p>Hello world</p>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
    expect(html).toMatch(/<ul>[\s\S]*<\/ul>/);
  });
});
