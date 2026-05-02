import { encode } from "gpt-tokenizer";

/**
 * Estimate token count for an arbitrary string using the cl100k_base tokenizer
 * (GPT-3.5/4 family). Close enough to most modern frontier-model tokenizers
 * for the kind of bytes-vs-tokens comparison the README hero needs.
 *
 * For an MCP tool list, we typically pass the JSON-stringified array.
 */
export function countTokens(input: string): number {
  if (!input) return 0;
  return encode(input).length;
}

export function countObjectTokens(obj: unknown): number {
  return countTokens(JSON.stringify(obj));
}

export function byteLength(input: string): number {
  return Buffer.byteLength(input, "utf8");
}
