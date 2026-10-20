import { describe, expect, it } from "vitest";

import {
  OURA_COLLECTIONS,
  OURA_OAUTH_SCOPE,
  OURA_SCOPE_GATED_COLLECTIONS,
  ouraCollectionsMissingFromGrant,
  ouraScopeReconnectList,
  parseOuraGrantedScopes,
  parseOuraMissingScope,
} from "../scope";

describe("Oura scope map", () => {
  it("asks for the scope of every collection the sync reads", () => {
    const requested = new Set(OURA_OAUTH_SCOPE.split(" "));
    for (const c of OURA_COLLECTIONS) expect(requested).toContain(c.scope);
    expect(requested).toContain("personal");
  });

  it("puts resilience behind stress, not heart_health", () => {
    const scopeOf = Object.fromEntries(
      OURA_COLLECTIONS.map((c) => [c.name, c.scope]),
    );
    expect(scopeOf.resilience).toBe("stress");
    expect(scopeOf.spo2).toBe("spo2");
    expect(scopeOf.vo2max).toBe("heart_health");
    expect(scopeOf.cardio_age).toBe("heart_health");
    expect(OURA_OAUTH_SCOPE.split(" ")).toEqual([
      "daily",
      "spo2",
      "heart_health",
      "stress",
      "personal",
    ]);
  });

  it("derives the gated collections from the map, in display order", () => {
    expect([...OURA_SCOPE_GATED_COLLECTIONS]).toEqual([
      "spo2",
      "vo2max",
      "cardio_age",
      "resilience",
    ]);
    expect(ouraScopeReconnectList(["resilience", "readiness", "spo2"])).toEqual(
      ["spo2", "resilience"],
    );
  });
});

describe("granted scopes", () => {
  it("reads Oura's extapi-prefixed grant", () => {
    expect(
      parseOuraGrantedScopes("extapi:daily extapi:personal extapi:spo2"),
    ).toEqual(new Set(["daily", "personal", "spo2"]));
  });

  it("knows nothing when the response names no scopes", () => {
    expect(parseOuraGrantedScopes(undefined)).toBeNull();
    expect(parseOuraGrantedScopes("  ")).toBeNull();
    expect(ouraCollectionsMissingFromGrant(undefined)).toBeNull();
  });

  it("lists the gated collections a grant leaves out", () => {
    expect(
      ouraCollectionsMissingFromGrant(
        "extapi:daily extapi:personal extapi:spo2 extapi:heart_health",
      ),
    ).toEqual(["resilience"]);
    expect(
      ouraCollectionsMissingFromGrant(
        "daily personal spo2 heart_health stress",
      ),
    ).toEqual([]);
  });
});

describe("parseOuraMissingScope", () => {
  it("reads the scope a refusal names", () => {
    expect(
      parseOuraMissingScope({
        detail: "Token is not authorized access stress scope.",
      }),
    ).toBe("stress");
    expect(
      parseOuraMissingScope({
        detail: "Token is not authorized access extapi:heart_health scope.",
      }),
    ).toBe("heart_health");
  });

  it("returns null for a dead token or any other body", () => {
    expect(
      parseOuraMissingScope({
        detail:
          "The access token provided is expired, revoked, malformed, or invalid for other reasons.",
      }),
    ).toBeNull();
    expect(parseOuraMissingScope(null)).toBeNull();
    expect(parseOuraMissingScope({ detail: 42 })).toBeNull();
  });
});
