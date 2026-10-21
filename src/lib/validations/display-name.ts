/**
 * The one bound on a display name, for every surface that sets one: the setup
 * flow, the profile (web and native), and a managed profile. The setup flow
 * used to cap it at 50 while the profile took 80, so a name set later could
 * not be typed into the setup form of another device.
 */
import { z } from "zod/v4";

export const DISPLAY_NAME_MAX_LENGTH = 80;

/**
 * An optional display name: trimmed BEFORE its bounds are checked, so a value
 * of only spaces is the empty string, which every writer stores as "no name"
 * (null). It used to be checked untrimmed and trimmed after, which stored an
 * empty name for "   ".
 */
export const optionalDisplayNameSchema = z
  .string()
  .trim()
  .max(DISPLAY_NAME_MAX_LENGTH);
