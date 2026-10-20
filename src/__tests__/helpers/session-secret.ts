/**
 * A session cookie secret of the exact shape `createSession` mints (`hls_`
 * and 32 random bytes in hex). The session lookup refuses any other shape
 * before it asks the database, so a fixture that invents a readable secret
 * tests the refusal, not the lookup.
 */
import { randomBytes } from "node:crypto";

export function fixtureSessionSecret(): string {
  return `hls_${randomBytes(32).toString("hex")}`;
}
