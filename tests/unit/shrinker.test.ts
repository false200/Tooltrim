import { describe, expect, it } from "vitest";
import { Shrinker } from "../../src/core/shrinker.js";

const baseOpts = {
  mode: "rules" as const,
  maxDescriptionChars: 80,
  dedupeSchemas: true,
};

describe("Shrinker - description rules", () => {
  it("strips boilerplate prefixes and markdown decoration", () => {
    const s = new Shrinker(baseOpts);
    const out = s.shrinkDescription(
      "**This tool** echoes the provided text back to the caller. Returns a JSON object containing the echoed text.",
      80,
    );
    expect(out.toLowerCase()).not.toMatch(/^this tool/);
    expect(out).not.toContain("**");
    expect(out).not.toContain("Returns a JSON object containing");
  });

  it("removes filler phrases", () => {
    const s = new Shrinker(baseOpts);
    const out = s.shrinkDescription(
      "Please utilize this tool in order to perform a query.",
      120,
    );
    expect(out.toLowerCase()).not.toContain("please");
    expect(out.toLowerCase()).not.toContain("in order to");
    expect(out.toLowerCase()).not.toContain("utilize");
  });

  it("truncates at the first sentence boundary past maxChars", () => {
    const s = new Shrinker({ ...baseOpts, maxDescriptionChars: 30 });
    const desc =
      "Aaaaaa bbbbbbb ccccccc ddddddd eeeeeee. Fffff ggggg hhhhh. Iiiiiiii jjjjjj.";
    const out = s.shrinkDescription(desc, 30);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out).toMatch(/[.!?…]$/);
  });

  it("is deterministic - same input -> same output", () => {
    const s = new Shrinker(baseOpts);
    const desc =
      "This tool fetches a user. Use this when you need details. Returns a JSON object containing the user.";
    const a = s.shrinkDescription(desc, 80);
    const b = s.shrinkDescription(desc, 80);
    expect(a).toBe(b);
  });

  it("returns input unchanged when mode is 'off'", () => {
    const s = new Shrinker({ ...baseOpts, mode: "off" });
    const desc = "**This tool** is verbose.";
    expect(s.shrinkDescription(desc, 80)).toBe(desc);
  });
});

describe("Shrinker - schema dedup", () => {
  it("hoists repeated sub-schemas into $defs and replaces with $ref", () => {
    const s = new Shrinker(baseOpts);
    const userSchema = {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id", "name"],
    };
    const schema = {
      type: "object",
      properties: {
        author: userSchema,
        reviewer: userSchema,
        title: { type: "string" },
      },
    };
    const out = s.dedupeSchema(schema as any) as any;
    const props = out.properties;
    expect(out.$defs).toBeTruthy();
    const defKeys = Object.keys(out.$defs);
    expect(defKeys.length).toBeGreaterThanOrEqual(1);
    expect(props.author.$ref).toMatch(/^#\/\$defs\//);
    expect(props.reviewer.$ref).toBe(props.author.$ref);
  });

  it("leaves single-occurrence schemas alone", () => {
    const s = new Shrinker(baseOpts);
    const schema = {
      type: "object",
      properties: { x: { type: "string" } },
    };
    const out = s.dedupeSchema(schema as any) as any;
    expect(out.$defs).toBeUndefined();
    expect(out.properties.x.type).toBe("string");
  });
});

describe("Shrinker.shrinkTool", () => {
  it("never mutates the input", () => {
    const s = new Shrinker(baseOpts);
    const tool = {
      name: "echo",
      description: "**This tool** echoes text.",
      inputSchema: {
        type: "object" as const,
        properties: { text: { type: "string" } },
      },
    };
    const original = structuredClone(tool);
    s.shrinkTool(tool);
    expect(tool).toEqual(original);
  });
});
