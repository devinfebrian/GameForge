import { describe, expect, test } from "bun:test";
import { escapeHtml, escapeInlineScript, stripModuleSyntax } from "@/lib/export/html";

describe("escapeHtml", () => {
  test("escapes the characters that could open an element", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  test("escapes ampersands before anything else", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  test("escapes attribute-breaking quotes", () => {
    expect(escapeHtml('a "b"')).toBe("a &quot;b&quot;");
  });
});

describe("escapeInlineScript", () => {
  test("neutralises the sequence that ends a script element", () => {
    expect(escapeInlineScript('const a = "</script>";')).toBe(
      'const a = "<\\/script>";',
    );
  });

  test("is case-insensitive, because the HTML parser is", () => {
    expect(escapeInlineScript("</SCRIPT>")).toBe("<\\/SCRIPT>");
  });

  test("leaves other closing tags alone", () => {
    expect(escapeInlineScript("</div></body>")).toBe("</div></body>");
  });

  test("escapes every occurrence, not just the first", () => {
    expect(escapeInlineScript("</script></script>")).toBe("<\\/script><\\/script>");
  });

  test("neutralises the comment opener that reaches the escaped states", () => {
    expect(escapeInlineScript("<!--<script>x</script>")).toBe(
      "<\\u0021--<script>x<\\/script>",
    );
  });

  test("keeps the meaning of an escaped comment opener", () => {
    const original = "<!--<script>";

    expect(new Function(`return "${escapeInlineScript(original)}";`)()).toBe(original);
  });

  test("stays valid inside a unicode-flag regex", () => {
    // `\!` would throw here, and that SyntaxError would take the whole export
    // down if a vendor bundle or scene carried `<!--` in a `/u` regex.
    const regex = new RegExp(escapeInlineScript("<!--"), "u");

    expect(regex.test("<!--")).toBe(true);
  });

  test("produces a string that parses back to the original in JavaScript", () => {
    const original = "a</script>b";

    // Same evaluation as the browser will perform on the escaped text.
    expect(new Function(`return "${escapeInlineScript(original)}";`)()).toBe(original);
  });
});

describe("stripModuleSyntax", () => {
  test("removes an exported declaration keyword", () => {
    expect(stripModuleSyntax("export const soundFx = {};")).toBe("const soundFx = {};");
    expect(stripModuleSyntax("export function play() {}")).toBe("function play() {}");
    expect(stripModuleSyntax("export class Scene {}")).toBe("class Scene {}");
  });

  test("removes a default export", () => {
    expect(stripModuleSyntax("export default soundFx;")).toBe("soundFx;");
  });

  test("drops an export list", () => {
    expect(stripModuleSyntax("export { a, b };")).toBe("");
  });

  test("drops an import line", () => {
    expect(stripModuleSyntax('import { a } from "./b.js";')).toBe("");
  });

  test("only rewrites the start of a line", () => {
    const source = 'const message = "export const";';

    expect(stripModuleSyntax(source)).toBe(source);
  });

  test("keeps the rest of the file intact", () => {
    const source = [
      "export const soundFx = {",
      "  play() {",
      "    return true;",
      "  },",
      "};",
      "",
      "window.soundFx = soundFx;",
    ].join("\n");

    const stripped = stripModuleSyntax(source);

    expect(stripped).not.toContain("export");
    expect(stripped).toContain("window.soundFx = soundFx;");
    expect(stripped).toContain("play() {");
  });
});
