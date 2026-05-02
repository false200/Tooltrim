import { describe, expect, it } from "vitest";
import { unsafeDecodeBearer } from "../../src/policy/oauth.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

describe("unsafeDecodeBearer", () => {
  it("returns undefined for missing header", () => {
    expect(unsafeDecodeBearer(undefined)).toBeUndefined();
    expect(unsafeDecodeBearer("")).toBeUndefined();
  });

  it("returns undefined for non-Bearer schemes", () => {
    expect(unsafeDecodeBearer("Basic dXNlcjpwYXNz")).toBeUndefined();
  });

  it("extracts standard claims from a JWT", () => {
    const jwt = makeJwt({
      sub: "user-123",
      iss: "https://idp.example.com",
      aud: "mcp",
      scope: "read:tools",
      client_id: "claude-code",
    });
    const claims = unsafeDecodeBearer(`Bearer ${jwt}`);
    expect(claims).toEqual({
      sub: "user-123",
      iss: "https://idp.example.com",
      aud: "mcp",
      scope: "read:tools",
      client_id: "claude-code",
    });
  });

  it("survives malformed tokens", () => {
    expect(unsafeDecodeBearer("Bearer not.a.jwt")).toBeUndefined();
    expect(unsafeDecodeBearer("Bearer junk")).toBeUndefined();
  });
});
