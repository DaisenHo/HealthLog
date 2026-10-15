/**
 * The `Biomarker` DTO, one shape for the list, the detail, the edit and the
 * merge result. The encrypted context bytes are never echoed: `hasContext`
 * flags them and `context` carries the plaintext. `aliases` are the other
 * spellings the marker answers to (v1.43), sorted, without its own name.
 */
import {
  decryptContextFromBytes,
  decryptContextSoft,
} from "@/lib/labs/biomarker-store";

export interface BiomarkerDtoRow {
  id: string;
  name: string;
  unit: string;
  lowerBound: number | null;
  upperBound: number | null;
  panel: string | null;
  analyteKey: string | null;
  hidden: boolean;
  contextEncrypted: Uint8Array | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `soft` decrypts fail-soft (the list: one bad row must not 500 the catalog);
 * otherwise a decrypt failure throws so a key gap surfaces on the detail.
 */
export function serialiseBiomarker(
  row: BiomarkerDtoRow,
  aliases: readonly string[],
  options: { soft?: boolean } = {},
) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    lowerBound: row.lowerBound,
    upperBound: row.upperBound,
    panel: row.panel,
    analyteKey: row.analyteKey,
    hasContext: row.contextEncrypted !== null,
    context: options.soft
      ? decryptContextSoft(row.contextEncrypted)
      : row.contextEncrypted
        ? decryptContextFromBytes(row.contextEncrypted)
        : null,
    hidden: row.hidden,
    aliases: [...aliases],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type BiomarkerDto = ReturnType<typeof serialiseBiomarker>;
