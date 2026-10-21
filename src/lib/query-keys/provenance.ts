/**
 * Query keys — the source-provenance reads (#1204).
 * Part of the centralized factory; aggregated in `./index.ts`.
 */
export const provenanceKeys = {
  provenanceDay: (type: string, date: string) =>
    ["provenance", "day", type, date] as const,
  provenanceCompare: (opts: {
    type: string;
    from: string;
    to: string;
    a?: string;
    b?: string;
  }) => ["provenance", "compare", opts] as const,
};
