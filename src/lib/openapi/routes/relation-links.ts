/**
 * OpenAPI route table — relation links (v1.43).
 *
 * Part of the OpenAPI route table; aggregated in `./index.ts`. The link
 * bodies reuse the runtime schemas from `@/lib/validations/relation-links`.
 * `RelatedLink` is the entry of the `related` list six detail responses carry
 * (lab result, visit, document, condition episode, medication, vaccination).
 */
import type { ZodOpenApiObject } from "zod-openapi";
import { z } from "zod/v4";

import {
  RELATED_KINDS,
  RELATED_VIA,
  labResultLinkSchema,
  medicationLinkSchema,
} from "@/lib/validations/relation-links";

import { dataEnvelope, errorEnvelope, stdResponses } from "./shared";

export const relatedLink = z
  .object({
    kind: z.enum(RELATED_KINDS),
    id: z.string(),
    label: z.string(),
    date: z
      .string()
      .nullable()
      .describe("`YYYY-MM-DD` or an ISO instant, as the record carries it."),
    href: z
      .string()
      .describe(
        "The web path of the related record, the same form as a push `url`.",
      ),
    via: z
      .enum(RELATED_VIA)
      .describe(
        "`direct` for a stored link; `encounter` when the relation runs through a visit both are filed against; `efficacyTarget` for a medication whose efficacy target is this lab marker.",
      ),
  })
  .meta({
    id: "RelatedLink",
    description:
      "One record related to the one shown. Only kinds whose module is on and that the caller's sharing grant covers are listed. Skip an unknown `kind`.",
  });

/** The optional `related` list a detail response carries since v1.43. */
export const relatedList = z
  .array(relatedLink)
  .optional()
  .describe(
    "v1.43 — records related to this one, resolved on the server. Absent on older servers.",
  );

/**
 * A detail response with its `related` list: the published component of the
 * record (by `$ref`) and the list beside it, so list endpoints that share the
 * component do not claim the field.
 */
export function withRelated<T extends z.ZodType>(detail: T) {
  return z.intersection(detail, z.object({ related: relatedList }));
}

const linkResult = z
  .object({
    changed: z.number().int(),
    unknown: z
      .array(z.string())
      .describe("Ids that name nothing this account owns; nothing failed."),
  })
  .meta({ id: "RelationLinkResult" });

const medicationLinkRequest = medicationLinkSchema.meta({
  id: "MedicationLinkRequest",
});
const labResultLinkRequest = labResultLinkSchema.meta({
  id: "LabResultLinkRequest",
});

function linkOperations(
  path: string,
  noun: string,
  request: z.ZodType,
  invalidCode: string,
  idPrefix: string,
) {
  const op = (verb: "post" | "delete") => ({
    tags: ["Links"],
    summary:
      verb === "post"
        ? `File records against a ${noun} (v1.43)`
        : `Unfile records from a ${noun} (v1.43)`,
    description: `Idempotent; at most 100 ids. An id that names nothing this account owns comes back in \`unknown\` instead of failing. 404 when the ${noun} is not found; 422 \`${invalidCode}\` for a malformed body. Own account only, as the other link routes.`,
    requestParams: { path: z.object({ id: z.string() }) },
    requestBody: {
      required: true,
      content: { "application/json": { schema: request } },
    },
    responses: {
      "200": {
        description: "How many links changed, and which ids were unknown.",
        content: {
          "application/json": {
            schema: dataEnvelope(
              linkResult,
              `${idPrefix}${verb === "post" ? "Link" : "Unlink"}Response`,
            ),
          },
        },
      },
      "404": {
        description: `The ${noun} was not found.`,
        content: { "application/json": { schema: errorEnvelope } },
      },
      ...stdResponses,
    },
  });
  return { [path]: { post: op("post"), delete: op("delete") } };
}

export const relationLinkPaths: NonNullable<ZodOpenApiObject["paths"]> = {
  ...linkOperations(
    "/api/medications/{id}/links",
    "medication",
    medicationLinkRequest,
    "medication.link.invalid",
    "Medication",
  ),
  ...linkOperations(
    "/api/labs/{id}/links",
    "lab result",
    labResultLinkRequest,
    "labs.link.invalid",
    "LabResult",
  ),
};
