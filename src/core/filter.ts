import micromatch from "micromatch";
import type { McpDietConfig } from "../config/schema.js";

export interface FilterOptions {
  allow: string[];
  deny: string[];
  apply?: { tools?: boolean; resources?: boolean; prompts?: boolean };
}

export type Primitive = "tool" | "resource" | "prompt";

/**
 * Allow/deny glob filter, evaluated against the namespaced name.
 *
 * Semantics:
 *  - empty `allow` => everything is allowed by default,
 *  - non-empty `allow` => only matches are allowed,
 *  - then `deny` is applied last and always wins.
 *
 * The same instance is shared across listings AND `tools/call`, so a denied
 * tool can never be invoked even if the host already cached it.
 */
export class ToolFilter {
  private readonly allow: string[];
  private readonly deny: string[];
  private readonly applyTools: boolean;
  private readonly applyResources: boolean;
  private readonly applyPrompts: boolean;

  constructor(opts: FilterOptions) {
    this.allow = opts.allow;
    this.deny = opts.deny;
    const apply = opts.apply ?? {};
    this.applyTools = apply.tools ?? true;
    this.applyResources = apply.resources ?? true;
    this.applyPrompts = apply.prompts ?? true;
  }

  static fromConfig(cfg: McpDietConfig): ToolFilter {
    return new ToolFilter({
      allow: cfg.filters.allow,
      deny: cfg.filters.deny,
      apply: cfg.filters.apply,
    });
  }

  isAllowed(namespacedName: string, kind: Primitive = "tool"): boolean {
    if (kind === "tool" && !this.applyTools) return true;
    if (kind === "resource" && !this.applyResources) return true;
    if (kind === "prompt" && !this.applyPrompts) return true;

    if (this.allow.length > 0 && !micromatch.isMatch(namespacedName, this.allow)) {
      return false;
    }
    if (this.deny.length > 0 && micromatch.isMatch(namespacedName, this.deny)) {
      return false;
    }
    return true;
  }

  filter<T extends { name: string }>(items: T[], kind: Primitive = "tool"): T[] {
    return items.filter((item) => this.isAllowed(item.name, kind));
  }
}
