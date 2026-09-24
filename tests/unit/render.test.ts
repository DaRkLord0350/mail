import { describe, expect, it } from "vitest";
import { findMalformedPlaceholders, leadContext, renderEmail, renderTemplate, textToHtml, uniqueVariableKeys } from "@/lib/template/render";

const ctx = { first_name: "Asha", company_name: "Acme", empty: "", blank: "   " };

describe("personalization", () => {
  it("renders a normal variable", () => {
    const r = renderTemplate("Hi {{first_name}} at {{company_name}}!", ctx, { behavior: "SKIP" });
    expect(r.text).toBe("Hi Asha at Acme!");
    expect(r.missing).toEqual([]);
  });

  it("SKIP: missing variable is left in place and reported as missing", () => {
    const r = renderTemplate("Hi {{last_name}}", ctx, { behavior: "SKIP" });
    expect(r.text).toBe("Hi {{last_name}}");
    expect(r.missing).toEqual(["last_name"]);
    const e = renderEmail("S", "Hi {{last_name}}", ctx, { behavior: "SKIP" });
    expect(e.blocked).toBe(true);
  });

  it("REMOVE: missing variable is removed and the text tidied", () => {
    const r = renderTemplate("Hi {{last_name}},", ctx, { behavior: "REMOVE" });
    expect(r.text).toBe("Hi,");
    expect(r.removed).toEqual(["last_name"]);
    expect(r.missing).toEqual([]);
    expect(renderTemplate("We met at {{event}} today.", ctx, { behavior: "REMOVE" }).text).toBe("We met at today.");
    expect(renderTemplate("Thanks {{last_name}}!", ctx, { behavior: "REMOVE" }).text).toBe("Thanks!");
    const e = renderEmail("Hi {{last_name}}", "Body", ctx, { behavior: "REMOVE" });
    expect(e.blocked).toBe(false);
    expect(e.subject).toBe("Hi");
  });

  it("REMOVE does not touch intentional spacing elsewhere", () => {
    const r = renderTemplate("A  B ,\n  indented {{x}}", ctx, { behavior: "REMOVE" });
    expect(r.text.startsWith("A  B ,\n  indented")).toBe(true);
  });

  it("empty/whitespace-only values count as missing", () => {
    expect(renderTemplate("{{empty}}{{blank}}", ctx, { behavior: "SKIP" }).missing).toEqual(["empty", "blank"]);
  });

  it("FALLBACK: uses the settings fallback when present", () => {
    const r = renderTemplate("Hi {{last_name}},", ctx, { behavior: "FALLBACK", fallbacks: { last_name: "friend" } });
    expect(r.text).toBe("Hi friend,");
    expect(r.fellBack).toEqual(["last_name"]);
    expect(r.missing).toEqual([]);
  });

  it("FALLBACK: without a settings fallback the variable is missing (blocks the send)", () => {
    const r = renderTemplate("Hi {{last_name}},", ctx, { behavior: "FALLBACK", fallbacks: {} });
    expect(r.missing).toEqual(["last_name"]);
    const blankFb = renderTemplate("Hi {{last_name}},", ctx, { behavior: "FALLBACK", fallbacks: { last_name: "  " } });
    expect(blankFb.missing).toEqual(["last_name"]);
  });

  it("inline fallback {{first_name|there}} wins regardless of behavior, value wins over fallback", () => {
    for (const behavior of ["SKIP", "REMOVE", "FALLBACK"] as const) {
      expect(renderTemplate("Hi {{nick|there}},", ctx, { behavior, fallbacks: { nick: "settings" } }).text).toBe("Hi there,");
    }
    expect(renderTemplate("Hi {{first_name|there}},", ctx, { behavior: "SKIP" }).text).toBe("Hi Asha,");
    expect(renderTemplate("Hi {{ nick | my friend }},", ctx, { behavior: "SKIP" }).text).toBe("Hi my friend,");
  });

  it("unknown variables are treated as missing", () => {
    const r = renderTemplate("{{totally_unknown}}", ctx, { behavior: "SKIP" });
    expect(r.missing).toEqual(["totally_unknown"]);
  });

  it("special characters in values are inserted literally", () => {
    const special = { a: "$& and $1 and $$", b: "<b>Tom & \"Jerry\"</b>", c: "Zoë 🚀 日本" };
    const r = renderTemplate("[{{a}}] [{{b}}] [{{c}}]", special, { behavior: "SKIP" });
    expect(r.text).toBe('[$& and $1 and $$] [<b>Tom & "Jerry"</b>] [Zoë 🚀 日本]');
  });

  it("a value containing {{...}} is never re-rendered (treated as missing)", () => {
    const r = renderTemplate("Hi {{first_name}}", { first_name: "{{company_name}}", company_name: "Leak" }, { behavior: "SKIP" });
    expect(r.text).not.toContain("Leak");
    expect(r.missing).toEqual(["first_name"]);
    const withFb = renderTemplate("Hi {{first_name|there}}", { first_name: "{{x}}" }, { behavior: "SKIP" });
    expect(withFb.text).toBe("Hi there");
  });

  it("placeholders are whitespace- and case-insensitive", () => {
    expect(renderTemplate("{{ First_Name }} {{COMPANY_NAME}}", ctx, { behavior: "SKIP" }).text).toBe("Asha Acme");
    expect(renderTemplate("{{first_name}}", { First_Name: "Up" }, { behavior: "SKIP" }).text).toBe("Up");
  });

  it("subject newlines are collapsed; body newlines kept", () => {
    const e = renderEmail("Hello\r\n{{first_name}}\nthere", "Line1\nLine2", ctx, { behavior: "SKIP" });
    expect(e.subject).toBe("Hello Asha there");
    expect(e.body).toBe("Line1\nLine2");
  });

  it("a value with newlines injected into the subject cannot add headers", () => {
    const e = renderEmail("Hi {{first_name}}", "b", { first_name: "A\r\nBcc: evil@x.com" }, { behavior: "SKIP" });
    expect(e.subject).not.toMatch(/[\r\n]/);
  });

  it("textToHtml escapes HTML, linkifies URLs and keeps line breaks", () => {
    const html = textToHtml('<script>alert("x")</script> & more\nSee https://example.com/a?b=1&c=2.');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more<br>");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2">https://example.com/a?b=1&amp;c=2</a>.');
  });

  it("textToHtml does not linkify javascript: URLs", () => {
    expect(textToHtml("javascript:alert(1)")).not.toContain("<a ");
  });

  it("findMalformedPlaceholders", () => {
    expect(findMalformedPlaceholders("Hi {{first_name}}")).toEqual([]);
    expect(findMalformedPlaceholders("Hi {{first name}}")).toEqual(["{{first name}}"]);
    expect(findMalformedPlaceholders("Hi {{first_name")).toEqual(["{{first_name"]);
    expect(findMalformedPlaceholders("Hi {first_name}}")).toEqual(["{first_name}}"]);
    expect(findMalformedPlaceholders("{{a|fallback}} {x} {{ b }}")).toEqual([]);
  });

  it("uniqueVariableKeys lowercases and de-duplicates", () => {
    expect(uniqueVariableKeys("{{First_Name}} {{first_name|x}}", "{{company_name}}")).toEqual(["first_name", "company_name"]);
  });

  it("leadContext: canonical fields override metadata, full_name derived", () => {
    const c = leadContext({ email: "a@x.com", firstName: "Ann", lastName: "Lee", metadata: { first_name: "meta", instagram_handle: "@a" } }, { unsubscribe_url: "u" });
    expect(c.first_name).toBe("Ann");
    expect(c.full_name).toBe("Ann Lee");
    expect(c.instagram_handle).toBe("@a");
    expect(c.unsubscribe_url).toBe("u");
  });
});
