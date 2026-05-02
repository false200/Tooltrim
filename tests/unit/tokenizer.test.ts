import { describe, expect, it } from "vitest";
import { byteLength, countObjectTokens, countTokens } from "../../src/core/tokenizer.js";

describe("tokenizer", () => {
  it("returns 0 for empty input", () => {
    expect(countTokens("")).toBe(0);
  });

  it("approximates token counts for realistic text", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const n = countTokens(text);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(text.length); // tokens always ≤ chars for English
  });

  it("counts JSON-stringified objects deterministically", () => {
    const obj = { tools: [{ name: "echo", description: "echo text" }] };
    const a = countObjectTokens(obj);
    const b = countObjectTokens(obj);
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
  });

  it("byteLength agrees with Buffer.byteLength for utf8", () => {
    expect(byteLength("héllo")).toBe(Buffer.byteLength("héllo", "utf8"));
  });
});
