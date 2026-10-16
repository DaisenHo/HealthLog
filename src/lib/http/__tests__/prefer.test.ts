import { describe, expect, it } from "vitest";

import { hasPreference, RETURN_REPRESENTATION } from "../prefer";

function req(prefer?: string): Request {
  return new Request("http://localhost/x", {
    headers: prefer === undefined ? {} : { prefer },
  });
}

describe("hasPreference", () => {
  it("is false without the header", () => {
    expect(hasPreference(req(), RETURN_REPRESENTATION)).toBe(false);
  });

  it("finds a valued preference among several, with parameters and case", () => {
    expect(
      hasPreference(
        req("respond-async, Return=Representation; foo=bar"),
        RETURN_REPRESENTATION,
      ),
    ).toBe(true);
    expect(
      hasPreference(req("return = representation"), "return=representation"),
    ).toBe(true);
  });

  it("does not take a different value of the same preference", () => {
    expect(hasPreference(req("return=minimal"), RETURN_REPRESENTATION)).toBe(
      false,
    );
  });

  it("reads a bare token", () => {
    expect(hasPreference(req("respond-async; wait=10"), "respond-async")).toBe(
      true,
    );
  });
});
