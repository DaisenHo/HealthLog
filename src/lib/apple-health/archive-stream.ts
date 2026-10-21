/**
 * Bounded ZIP reader for Apple Health's auxiliary members: the ECG CSVs and
 * the workout-route GPX files.
 *
 * ZIP entry names are treated as untrusted identifiers only: no archive member
 * is ever materialised on disk. Central-directory metadata is checked before
 * decompression, then the real decompressed byte count is enforced while
 * inflating so forged size metadata cannot bypass the limits.
 */
import { open, type FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

export interface AppleHealthArchiveLimits {
  maxMembers: number;
  maxEcgMembers: number;
  maxMemberBytes: number;
  maxTotalEcgBytes: number;
  maxCompressionRatio: number;
}

export interface AppleHealthArchiveMember {
  name: string;
  stream: Readable;
}

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_535 + 22;
const ECG_PREFIX = "apple_health_export/electrocardiograms/";
const ROUTE_PREFIX = "apple_health_export/workout-routes/";

/**
 * One family of auxiliary members: which names belong to it, the label its
 * errors carry, and its own count and total-byte ceilings.
 */
interface MemberKind {
  label: string;
  matches: (name: string) => boolean;
  maxMembers: number;
  maxTotalBytes: number;
}

function archiveError(message: string): Error {
  return new Error(`Unsafe Apple Health archive: ${message}`);
}

function assertPositiveLimits(limits: AppleHealthArchiveLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw archiveError("invalid resource limit");
    }
  }
}

async function readExactly(
  handle: FileHandle,
  length: number,
  position: number,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(position) ||
    length < 0 ||
    position < 0
  ) {
    throw archiveError("invalid member bounds");
  }
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const read = await handle.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (read.bytesRead === 0) {
      throw archiveError("truncated member data");
    }
    offset += read.bytesRead;
  }
  return buffer;
}

function isUnsafeName(name: string): boolean {
  if (
    name.length === 0 ||
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.includes("\uFFFD")
  ) {
    return true;
  }
  const segments = name.split("/");
  return segments.some((segment) => segment === "." || segment === "..");
}

function isDirectChild(name: string, prefix: string, extension: string) {
  return (
    name.startsWith(prefix) &&
    name.length > prefix.length &&
    name.toLowerCase().endsWith(extension) &&
    !name.slice(prefix.length).includes("/")
  );
}

function isEcgCsv(name: string): boolean {
  return isDirectChild(name, ECG_PREFIX, ".csv");
}

/** A workout route as the archive names it: `workout-routes/<file>.gpx`. */
export function isWorkoutRouteGpx(name: string): boolean {
  return isDirectChild(name, ROUTE_PREFIX, ".gpx");
}

/**
 * The archive member a `<FileReference path="…">` inside a `<Workout>`
 * points at. Apple writes the path from the export root
 * (`/workout-routes/route_….gpx`); the member carries the export folder in
 * front. Null for anything that is not a direct route file.
 */
export function routeMemberNameFromReference(path: string): string | null {
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  const name = `apple_health_export/${trimmed}`;
  return isWorkoutRouteGpx(name) ? name : null;
}

async function readCentralDirectory(
  handle: FileHandle,
  fileSize: number,
  limits: AppleHealthArchiveLimits,
  kind: MemberKind,
): Promise<ZipEntry[]> {
  if (fileSize < 22) throw archiveError("missing ZIP directory");

  const tailLength = Math.min(fileSize, MAX_EOCD_SEARCH);
  const tail = await readExactly(handle, tailLength, fileSize - tailLength);
  let eocdOffset = -1;
  for (let cursor = tail.length - 22; cursor >= 0; cursor -= 1) {
    if (tail.readUInt32LE(cursor) === EOCD_SIGNATURE) {
      eocdOffset = cursor;
      break;
    }
  }
  if (eocdOffset < 0) throw archiveError("missing ZIP directory");

  const disk = tail.readUInt16LE(eocdOffset + 4);
  const centralDisk = tail.readUInt16LE(eocdOffset + 6);
  const diskEntries = tail.readUInt16LE(eocdOffset + 8);
  const totalEntries = tail.readUInt16LE(eocdOffset + 10);
  const centralSize = tail.readUInt32LE(eocdOffset + 12);
  const centralOffset = tail.readUInt32LE(eocdOffset + 16);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw archiveError("unsupported multi-disk or ZIP64 archive");
  }
  if (totalEntries > limits.maxMembers) {
    throw archiveError("member count limit exceeded");
  }
  if (centralOffset + centralSize > fileSize) {
    throw archiveError("invalid ZIP directory bounds");
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  let kindCount = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    const header = await readExactly(handle, 46, cursor);
    if (header.readUInt32LE(0) !== CENTRAL_SIGNATURE) {
      throw archiveError("malformed ZIP member directory");
    }
    const flags = header.readUInt16LE(8);
    const method = header.readUInt16LE(10);
    const compressedSize = header.readUInt32LE(20);
    const uncompressedSize = header.readUInt32LE(24);
    const nameLength = header.readUInt16LE(28);
    const extraLength = header.readUInt16LE(30);
    const commentLength = header.readUInt16LE(32);
    const localHeaderOffset = header.readUInt32LE(42);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw archiveError("unsupported ZIP64 member");
    }

    const nameBuffer = await readExactly(handle, nameLength, cursor + 46);
    const name = nameBuffer.toString("utf8");
    if (isUnsafeName(name)) throw archiveError("unsafe member path");
    if (names.has(name)) throw archiveError("duplicate member name");
    names.add(name);

    if (kind.matches(name)) {
      kindCount += 1;
      if (kindCount > kind.maxMembers) {
        throw archiveError(`${kind.label} member count limit exceeded`);
      }
      if ((flags & 0x1) !== 0) {
        throw archiveError(`encrypted ${kind.label} member is unsupported`);
      }
      if (method !== 0 && method !== 8) {
        throw archiveError(`unsupported ${kind.label} compression method`);
      }
      if (uncompressedSize > limits.maxMemberBytes) {
        throw archiveError(`${kind.label} member byte limit exceeded`);
      }
      const ratio = uncompressedSize / Math.max(1, compressedSize);
      if (ratio > limits.maxCompressionRatio) {
        throw archiveError(`${kind.label} compression ratio limit exceeded`);
      }
    }

    entries.push({
      name,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > centralOffset + centralSize) {
      throw archiveError("invalid ZIP directory size");
    }
  }
  return entries;
}

async function decompressEntry(
  handle: FileHandle,
  entry: ZipEntry,
  fileSize: number,
  limits: AppleHealthArchiveLimits,
  kind: MemberKind,
  total: { bytes: number },
): Promise<Buffer[]> {
  const local = await readExactly(handle, 30, entry.localHeaderOffset);
  if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw archiveError("malformed local member header");
  }
  const localFlags = local.readUInt16LE(6);
  const localMethod = local.readUInt16LE(8);
  const nameLength = local.readUInt16LE(26);
  const extraLength = local.readUInt16LE(28);
  const localName = (
    await readExactly(handle, nameLength, entry.localHeaderOffset + 30)
  ).toString("utf8");
  if (
    localName !== entry.name ||
    localFlags !== entry.flags ||
    localMethod !== entry.method
  ) {
    throw archiveError("inconsistent member headers");
  }
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  if (dataOffset + entry.compressedSize > fileSize) {
    throw archiveError("invalid member data bounds");
  }

  const compressed = await readExactly(
    handle,
    entry.compressedSize,
    dataOffset,
  );
  const source =
    entry.method === 0
      ? Readable.from([compressed])
      : Readable.from([compressed]).pipe(createInflateRaw());
  const chunks: Buffer[] = [];
  let memberBytes = 0;

  try {
    for await (const value of source) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      memberBytes += chunk.byteLength;
      if (memberBytes > limits.maxMemberBytes) {
        throw archiveError(`actual ${kind.label} member byte limit exceeded`);
      }
      if (total.bytes + memberBytes > kind.maxTotalBytes) {
        throw archiveError(`total ${kind.label} byte limit exceeded`);
      }
      chunks.push(chunk);
    }
  } catch {
    for (const chunk of chunks) chunk.fill(0);
    throw archiveError(`${kind.label} decompression or byte limit failure`);
  } finally {
    compressed.fill(0);
  }

  total.bytes += memberBytes;
  return chunks;
}

/**
 * Yield the members of one kind as in-memory bounded streams, one at a time.
 * The complete central directory is validated before any health data is
 * yielded, so a structurally unsafe archive is never partly processed.
 * `wanted` narrows further (a route the export's XML actually references).
 */
async function* streamMembers(
  archivePath: string,
  limits: AppleHealthArchiveLimits,
  kind: MemberKind,
  wanted: (name: string) => boolean = () => true,
): AsyncGenerator<AppleHealthArchiveMember> {
  assertPositiveLimits(limits);
  const handle = await open(archivePath, "r");
  try {
    const stat = await handle.stat();
    const fileSize = Number(stat.size);
    if (!Number.isSafeInteger(fileSize)) {
      throw archiveError("archive is too large to address safely");
    }
    const entries = await readCentralDirectory(handle, fileSize, limits, kind);
    const total = { bytes: 0 };
    for (const entry of entries) {
      if (!kind.matches(entry.name) || !wanted(entry.name)) continue;
      const chunks = await decompressEntry(
        handle,
        entry,
        fileSize,
        limits,
        kind,
        total,
      );
      yield { name: entry.name, stream: Readable.from(chunks) };
    }
  } finally {
    await handle.close();
  }
}

/** Yield only Apple Health's ECG CSV members as in-memory bounded streams. */
export async function* streamAppleHealthEcgMembers(input: {
  archivePath: string;
  limits: AppleHealthArchiveLimits;
}): AsyncGenerator<AppleHealthArchiveMember> {
  yield* streamMembers(input.archivePath, input.limits, {
    label: "ECG",
    matches: isEcgCsv,
    maxMembers: input.limits.maxEcgMembers,
    maxTotalBytes: input.limits.maxTotalEcgBytes,
  });
}

/** Ceilings for the route members; the shared ones keep their meaning. */
export interface AppleHealthRouteArchiveLimits {
  maxMembers: number;
  maxRouteMembers: number;
  maxMemberBytes: number;
  maxTotalRouteBytes: number;
  maxCompressionRatio: number;
}

/**
 * Yield the workout-route GPX members `wanted` names, one bounded buffer at
 * a time: the caller parses and drops each before the next is inflated.
 */
export async function* streamAppleHealthRouteMembers(input: {
  archivePath: string;
  limits: AppleHealthRouteArchiveLimits;
  wanted: (name: string) => boolean;
}): AsyncGenerator<AppleHealthArchiveMember> {
  const { limits } = input;
  yield* streamMembers(
    input.archivePath,
    {
      maxMembers: limits.maxMembers,
      maxEcgMembers: limits.maxRouteMembers,
      maxMemberBytes: limits.maxMemberBytes,
      maxTotalEcgBytes: limits.maxTotalRouteBytes,
      maxCompressionRatio: limits.maxCompressionRatio,
    },
    {
      label: "route",
      matches: isWorkoutRouteGpx,
      maxMembers: limits.maxRouteMembers,
      maxTotalBytes: limits.maxTotalRouteBytes,
    },
    input.wanted,
  );
}
