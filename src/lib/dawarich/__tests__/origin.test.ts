import { afterEach, describe, expect, it } from "vitest";

import {
  configuredDawarichPrivateOrigins,
  DawarichOriginConfigError,
  evaluateDawarichUrl,
} from "../origin";

const NONE: ReadonlySet<string> = new Set();

afterEach(() => {
  delete process.env.DAWARICH_PRIVATE_ORIGINS;
});

describe("evaluateDawarichUrl", () => {
  it("lets a public instance through and keeps its path", () => {
    const target = evaluateDawarichUrl("https://8.8.8.8/dawarich/", NONE);
    expect(target).toMatchObject({
      allowed: true,
      baseUrl: "https://8.8.8.8/dawarich",
      privateOriginApproved: false,
    });
  });

  it("refuses a private instance the operator did not list", () => {
    const target = evaluateDawarichUrl("http://192.168.1.20:3000", NONE);
    expect(target.allowed).toBe(false);
    expect(target.reasonCode).toBe("private_origin_not_approved");
  });

  it("opens exactly the listed origin, not a sibling port", () => {
    const grants = new Set(["http://192.168.1.20:3000"]);
    expect(
      evaluateDawarichUrl("http://192.168.1.20:3000", grants),
    ).toMatchObject({ allowed: true, privateOriginApproved: true });
    expect(
      evaluateDawarichUrl("http://192.168.1.20:3001", grants).allowed,
    ).toBe(false);
  });

  it("refuses credentials and a query in the address", () => {
    expect(
      evaluateDawarichUrl("https://user:pw@8.8.8.8", NONE).reasonCode,
    ).toBe("invalid_origin");
    expect(
      evaluateDawarichUrl("https://8.8.8.8/?api_key=x", NONE).reasonCode,
    ).toBe("invalid_origin");
  });
});

describe("configuredDawarichPrivateOrigins", () => {
  it("reads the operator list", () => {
    process.env.DAWARICH_PRIVATE_ORIGINS =
      "http://dawarich.lan:3000, http://10.0.0.5";
    expect([...configuredDawarichPrivateOrigins()]).toEqual([
      "http://dawarich.lan:3000",
      "http://10.0.0.5",
    ]);
  });

  it("names a malformed entry instead of granting part of it", () => {
    process.env.DAWARICH_PRIVATE_ORIGINS = "http://*.lan";
    expect(() => configuredDawarichPrivateOrigins()).toThrow(
      DawarichOriginConfigError,
    );
  });
});
