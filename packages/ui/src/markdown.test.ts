import { describe, expect, it } from "vitest";
import { renderMarkdown, renderMarkdownWithAnchors, splitBlocks } from "./markdown.js";

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

describe("splitBlocks", () => {
  // The whole point of splitting on the raw source: a span has to slice back to
  // exactly the text it came from, or every anchor built on it is off.
  it("gives spans that slice back to their own source text", () => {
    const src = "# Title\n\nFirst para\nsecond line\n\n- a\n- b\n";
    const blocks = splitBlocks(src);
    expect(blocks.map((b) => src.slice(b.start, b.end))).toEqual([
      "# Title",
      "First para\nsecond line",
      "- a\n- b",
    ]);
  });

  // This is the regression test for the bug the rewrite exists to avoid.
  // Escaping before recording offsets shifts every span by the growth of
  // "&" -> "&amp;", and nothing on screen looks wrong when it happens.
  it("keeps offsets aligned when the source contains escapable characters", () => {
    const src = 'A & B < C\n\n"quoted" & <tagged>\n\nplain';
    const blocks = splitBlocks(src);
    expect(blocks.map((b) => src.slice(b.start, b.end))).toEqual([
      "A & B < C",
      '"quoted" & <tagged>',
      "plain",
    ]);
    // And the rendered output still escapes, so alignment is not bought by
    // skipping the escape.
    expect(renderMarkdown(src)).toContain("&amp;");
    expect(renderMarkdown(src)).not.toContain("<tagged>");
  });

  it("treats a blank line inside a fence as code, not a block boundary", () => {
    const src = "```js\nline one\n\nline two\n```\n\nafter";
    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.kind).toBe("fence");
    expect(src.slice(blocks[0]!.start, blocks[0]!.end)).toBe("```js\nline one\n\nline two\n```");
    expect(src.slice(blocks[1]!.start, blocks[1]!.end)).toBe("after");
  });

  it("runs an unterminated fence to the end rather than swallowing prose", () => {
    // Half-streamed code is a normal state to render, not a malformed document.
    const src = "intro\n\n```ts\nconst x = 1;";
    const blocks = splitBlocks(src);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.kind).toBe("fence");
    expect(src.slice(blocks[1]!.start, blocks[1]!.end)).toBe("```ts\nconst x = 1;");
  });

  it("excludes blank separators from every span", () => {
    const src = "one\n\n\n\ntwo";
    const blocks = splitBlocks(src);
    expect(blocks.map((b) => src.slice(b.start, b.end))).toEqual(["one", "two"]);
  });
});

describe("renderMarkdownWithAnchors", () => {
  it("anchors every block, index-aligned with the returned spans", () => {
    const src = "# Title\n\nsome prose\n\n```\ncode\n```";
    const { html, blocks } = renderMarkdownWithAnchors(src);
    expect(blocks).toHaveLength(3);
    for (let i = 0; i < blocks.length; i += 1) {
      expect(html, `block ${i} must be addressable`).toContain(`data-sc-block="${i}"`);
    }
    expect(html).toContain('<h2 data-sc-block="0">Title</h2>');
    expect(html).toContain('<pre data-sc-block="2">');
  });

  // The transcript renderer must stay clean: assistant prose has nothing to
  // address, and stray attributes in every bubble are noise.
  it("leaves renderMarkdown free of anchors", () => {
    const src = "# Title\n\nsome prose";
    expect(renderMarkdown(src)).not.toContain("data-sc-block");
    expect(renderMarkdownWithAnchors(src).html).toContain("data-sc-block");
  });

  it("renders the same markup as renderMarkdown once anchors are stripped", () => {
    const src = "# H\n\ntext with **bold**\n\n- a\n- b\n\n```js\nx\n```";
    const stripped = renderMarkdownWithAnchors(src).html.replace(/ data-sc-block="\d+"/g, "");
    expect(stripped).toBe(renderMarkdown(src));
  });
});
