import { cosmiconfig, type Loader } from "cosmiconfig";
import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { leanMcpConfigSchema, type LeanMcpConfig } from "./schema.js";

const yamlLoader: Loader = async (filepath: string) => {
  const text = await readFile(filepath, "utf8");
  return parseYaml(text);
};

const explorer = cosmiconfig("leanmcp", {
  searchPlaces: [
    "leanmcp.config.yaml",
    "leanmcp.config.yml",
    "leanmcp.config.json",
    "leanmcp.config.js",
    "leanmcp.config.mjs",
    ".leanmcp.yaml",
    ".leanmcp.yml",
    ".leanmcp.json",
    "package.json",
  ],
  packageProp: "leanmcp",
  loaders: {
    ".yaml": yamlLoader,
    ".yml": yamlLoader,
  },
});

export interface LoadOptions {
  /** Explicit path to a config file. If absent, walks up from cwd. */
  configPath?: string;
  /** Where to start the search if `configPath` is not given. */
  cwd?: string;
}

export interface LoadedConfig {
  config: LeanMcpConfig;
  filepath: string;
}

/**
 * Locate, parse, and validate the LeanMCP config. Substitutes `${VAR}` and
 * `${VAR:-default}` in string values from `process.env`.
 */
export async function loadConfig(opts: LoadOptions = {}): Promise<LoadedConfig> {
  const cwd = opts.cwd ?? process.cwd();
  const result = opts.configPath
    ? await explorer.load(path.resolve(cwd, opts.configPath))
    : await explorer.search(cwd);

  if (!result) {
    throw new Error(
      "No LeanMCP config found. Create leanmcp.config.yaml or pass --config <path>.",
    );
  }

  const expanded = expandEnv(result.config);
  return {
    config: validateConfig(expanded),
    filepath: result.filepath,
  };
}

export function validateConfig(raw: unknown): LeanMcpConfig {
  const parsed = leanMcpConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid LeanMCP config:\n${issues}`);
  }
  return parsed.data;
}

const ENV_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/gi;

function expandEnv<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(ENV_PATTERN, (_match, name: string, fallback?: string) => {
      const envValue = process.env[name];
      if (envValue !== undefined) return envValue;
      if (fallback !== undefined) return fallback;
      return "";
    }) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => expandEnv(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandEnv(v);
    }
    return out as unknown as T;
  }
  return value;
}
