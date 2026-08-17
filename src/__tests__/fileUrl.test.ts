import { describe, expect, it } from "vitest";
import { fileUrlSchema } from "../schemas/messageSchemas";

// The API stores attachment URLs supplied by the client rather than hosting
// files itself, so this schema is the only thing standing between a chat
// message and an arbitrary link — including one that executes.

const accepts = (value: string): boolean => fileUrlSchema.safeParse(value).success;

describe("Attachment URL validation", () => {
  it("accepts a plain https url", () => {
    expect(accepts("https://files.example.com/report.pdf")).toBe(true);
  });

  it("rejects javascript: urls", () => {
    // Stored and later rendered as a link, this is stored XSS.
    expect(accepts("javascript:alert(document.cookie)")).toBe(false);
  });

  it("rejects data: urls", () => {
    expect(accepts("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toBe(false);
  });

  it("rejects vbscript:, file: and blob: urls", () => {
    expect(accepts("vbscript:msgbox(1)")).toBe(false);
    expect(accepts("file:///etc/passwd")).toBe(false);
    expect(accepts("blob:https://example.com/1234")).toBe(false);
  });

  it("rejects plain http, which can be swapped in transit", () => {
    expect(accepts("http://files.example.com/report.pdf")).toBe(false);
  });

  it("rejects anything that is not a url", () => {
    expect(accepts("../../etc/passwd")).toBe(false);
    expect(accepts("not a url at all")).toBe(false);
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(accepts("")).toBe(false);
    expect(accepts("   ")).toBe(false);
  });

  it("rejects an absurdly long url", () => {
    expect(accepts(`https://example.com/${"a".repeat(3000)}`)).toBe(false);
  });

  it("is not fooled by a scheme hidden behind whitespace", () => {
    expect(accepts("  javascript:alert(1)  ")).toBe(false);
  });
});
