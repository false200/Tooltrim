import { describe, expect, it } from "vitest";
import { ToolFilter } from "../../src/core/filter.js";

describe("ToolFilter", () => {
  it("allows everything by default with no allow/deny", () => {
    const f = new ToolFilter({ allow: [], deny: [] });
    expect(f.isAllowed("github.create_issue")).toBe(true);
    expect(f.isAllowed("anything.at_all")).toBe(true);
  });

  it("respects allow as a strict gate", () => {
    const f = new ToolFilter({ allow: ["github.*"], deny: [] });
    expect(f.isAllowed("github.create_issue")).toBe(true);
    expect(f.isAllowed("linear.create_issue")).toBe(false);
  });

  it("denies override allow", () => {
    const f = new ToolFilter({ allow: ["github.*"], deny: ["github.delete_*"] });
    expect(f.isAllowed("github.create_issue")).toBe(true);
    expect(f.isAllowed("github.delete_issue")).toBe(false);
  });

  it("supports cross-namespace deny patterns", () => {
    const f = new ToolFilter({ allow: [], deny: ["*.admin_*"] });
    expect(f.isAllowed("github.admin_promote")).toBe(false);
    expect(f.isAllowed("linear.admin_purge")).toBe(false);
    expect(f.isAllowed("github.create_issue")).toBe(true);
  });

  it("filters arrays of items by their `name`", () => {
    const f = new ToolFilter({ allow: ["pg.*"], deny: ["pg.dangerous_*"] });
    const items = [
      { name: "pg.query" },
      { name: "pg.dangerous_drop" },
      { name: "github.x" },
    ];
    expect(f.filter(items).map((i) => i.name)).toEqual(["pg.query"]);
  });

  it("can be scoped to specific primitives", () => {
    const f = new ToolFilter({
      allow: ["x.*"],
      deny: [],
      apply: { tools: true, resources: false, prompts: false },
    });
    expect(f.isAllowed("y.foo", "tool")).toBe(false);
    expect(f.isAllowed("y.foo", "resource")).toBe(true);
    expect(f.isAllowed("y.foo", "prompt")).toBe(true);
  });
});
