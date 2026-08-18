/**
 * Reading a `.zip`, without a dependency.
 *
 * A Letterboxd export is an archive of nineteen files. Asking the user to unzip
 * it and then select the right CSVs one at a time is the worst step in the
 * product, and it silently costs them most of it: pick `watched.csv` alone and
 * there are no ratings and no dates, so there is nothing to draw a timeline from.
 *
 * This module exists rather than a package because the alternative is ~30KB of
 * dependency to avoid ~200 lines against a format that has not changed in forty
 * years, using a decompressor the browser already ships. `DecompressionStream`
 * is in Chrome 103+, Firefox 113+ and Safari 16.4+, and is feature-detected at
 * the point of use for anything older.
 *
 * Two rules, both learned from the real export:
 *
 *  1. **Sizes and offsets come from the central directory, never from a local
 *     file header.** Letterboxd writes entries with general-purpose flag bit 3
 *     set, which means the local header's size fields are zeroed and the true
 *     values trail the data in a descriptor. A reader that trusts local headers
 *     reads zero bytes per file on this exact archive.
 *  2. **Anything not understood is refused, not guessed at.** Zip64, encryption
 *     and unknown compression methods throw. The caller turns that into a
 *     diagnostic, and selecting loose CSVs still works, so a refusal costs the
 *     user a fallback rather than the product.
 *
 * The archive is untrusted input: it names its own decompressed sizes, so those
 * are treated as claims and the real budget is enforced while inflating.
 *
 * This module knows nothing about Letterboxd. The caller supplies `include`,
 * which also means nothing outside the wanted set is ever decompressed.
 */

export interface ArchiveEntry {
  readonly path: string;
  readonly text: string;
}

export interface ArchiveRead {
  readonly entries: readonly ArchiveEntry[];
  /** Entries deliberately not expanded — directories and anything `include` refused. */
  readonly ignored: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_FIXED_SIZE = 22;
const CENTRAL_FIXED_SIZE = 46;
const LOCAL_FIXED_SIZE = 30;

/** An archive comment is declared in 16 bits, so the EOCD is at most this far from the end. */
const MAX_COMMENT = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** Weak (ZipCrypto) and strong encryption respectively. Neither is supported. */
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;

/**
 * Where a 32-bit field means "too large, read the zip64 record instead".
 *
 * Detected and refused rather than implemented: a zip64 Letterboxd export would
 * mean a four-gigabyte viewing diary.
 */
const ZIP64_SIZE = 0xffffffff;
const ZIP64_COUNT = 0xffff;

/**
 * Caps, both against the archive's own claims about itself.
 *
 * A real export is tens of kilobytes, so these are three orders of magnitude of
 * headroom rather than a limit anyone will meet. They exist because the file
 * comes from outside and a compressed archive can claim to expand without bound.
 */
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

interface CentralEntry {
  readonly path: string;
  readonly method: number;
  readonly flags: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

/**
 * Locates the End of Central Directory record.
 *
 * Scanned backwards from the tail, and accepted only where the declared comment
 * length accounts for exactly the remaining bytes. The four signature bytes can
 * occur by coincidence inside compressed data; that consistency check is what
 * distinguishes the real record from a collision.
 */
function findEndOfCentralDirectory(view: DataView, length: number): number {
  const floor = Math.max(0, length - EOCD_FIXED_SIZE - MAX_COMMENT);
  for (let at = length - EOCD_FIXED_SIZE; at >= floor; at -= 1) {
    if (view.getUint32(at, true) !== EOCD_SIGNATURE) continue;
    const comment = view.getUint16(at + 20, true);
    if (at + EOCD_FIXED_SIZE + comment === length) return at;
  }
  return -1;
}

/**
 * Decodes an entry path.
 *
 * Read as UTF-8 whether or not the entry claims it (flag bit 11). The
 * alternative for un-flagged names is CP437, which in practice almost nothing
 * writes; and because a malformed byte becomes U+FFFD rather than throwing, a
 * name this gets wrong fails to match the caller's `include` and is skipped —
 * the right failure for a file we cannot identify.
 *
 * Backslashes are normalised so a separator written by a Windows packer is still
 * seen as a directory boundary by callers that care about nesting.
 */
function decodePath(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/\\/g, "/");
}

function readCentralDirectory(
  bytes: Uint8Array,
  view: DataView,
): readonly CentralEntry[] {
  const eocd = findEndOfCentralDirectory(view, bytes.byteLength);
  if (eocd < 0) {
    throw new Error("this file is not a readable zip archive");
  }

  const count = view.getUint16(eocd + 10, true);
  const offset = view.getUint32(eocd + 16, true);

  if (count === ZIP64_COUNT || offset === ZIP64_SIZE) {
    throw new Error("this archive uses the zip64 format, which EIGA cannot read");
  }
  if (offset >= bytes.byteLength) {
    throw new Error("this archive's directory points outside the file");
  }

  const entries: CentralEntry[] = [];
  let at = offset;

  for (let i = 0; i < count; i += 1) {
    if (at + CENTRAL_FIXED_SIZE > bytes.byteLength) {
      throw new Error("this archive's directory is truncated");
    }
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error("this archive's directory is malformed");
    }

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);

    if (compressedSize === ZIP64_SIZE || uncompressedSize === ZIP64_SIZE) {
      throw new Error("this archive uses the zip64 format, which EIGA cannot read");
    }

    const nameAt = at + CENTRAL_FIXED_SIZE;
    if (nameAt + nameLength > bytes.byteLength) {
      throw new Error("this archive's directory is truncated");
    }

    entries.push({
      path: decodePath(bytes.subarray(nameAt, nameAt + nameLength)),
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localOffset,
    });

    at = nameAt + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * Where an entry's data begins.
 *
 * The name and extra-field lengths are read from the *local* header because they
 * are allowed to differ from the central directory's copies — packers routinely
 * write different extra fields in the two places. Only these two lengths come
 * from here. The sizes do not: see rule 1 in the module comment.
 */
function findData(view: DataView, length: number, localOffset: number): number {
  if (localOffset + LOCAL_FIXED_SIZE > length) {
    throw new Error("this archive is truncated");
  }
  if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
    throw new Error("this archive's entry headers are malformed");
  }

  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  return localOffset + LOCAL_FIXED_SIZE + nameLength + extraLength;
}

/**
 * Inflates raw deflate data, refusing to exceed `budget`.
 *
 * The budget is checked against bytes actually produced rather than the size the
 * entry declares, because the declaration is the untrusted part. `deflate-raw`
 * rather than `deflate`: zip stores a bare deflate stream with no zlib wrapper.
 */
async function inflate(
  // Backed by a plain `ArrayBuffer` rather than `ArrayBufferLike`, which is what
  // lets these bytes be wrapped in a `Blob` — a `SharedArrayBuffer` view cannot.
  source: Uint8Array<ArrayBuffer>,
  budget: number,
): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "this browser cannot expand zip archives; unzip the export and select the CSVs instead",
    );
  }

  const stream = new Blob([source])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > budget) {
        throw new Error("this archive expands to more data than EIGA will read");
      }
      chunks.push(step.value);
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    throw cause instanceof Error
      ? cause
      : new Error("this archive's contents could not be expanded");
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Decodes entry text as UTF-8, dropping a byte-order mark Papa Parse would read as part of the first header. */
function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Expands the entries of `blob` that `include` accepts.
 *
 * Throws on anything it cannot read with confidence. Entries `include` refuses
 * are never decompressed and are only counted; an entry it accepts that then
 * fails to expand is fatal rather than skipped, because a silently missing
 * `diary.csv` would present as a library with no history and no explanation.
 */
export async function readZip(
  blob: Blob,
  include: (path: string) => boolean,
): Promise<ArchiveRead> {
  if (blob.size > MAX_ARCHIVE_BYTES) {
    throw new Error("this archive is larger than EIGA will read");
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength < EOCD_FIXED_SIZE) {
    throw new Error("this file is not a readable zip archive");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const central = readCentralDirectory(bytes, view);

  const entries: ArchiveEntry[] = [];
  let ignored = 0;
  let budget = MAX_TOTAL_BYTES;

  for (const entry of central) {
    // Directory markers carry no data. Nothing to expand, nothing to report.
    if (entry.path.endsWith("/")) {
      ignored += 1;
      continue;
    }
    if (!include(entry.path)) {
      ignored += 1;
      continue;
    }

    /*
      Validated here rather than during the directory walk, so an export that
      happens to contain one encrypted or oddly-compressed file EIGA does not
      want stays readable. Only what is actually read has to be understood.
    */
    if ((entry.flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) !== 0) {
      throw new Error("this archive is encrypted, which EIGA cannot read");
    }
    if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
      throw new Error("this archive uses a compression method EIGA cannot read");
    }

    const from = findData(view, bytes.byteLength, entry.localOffset);
    const to = from + entry.compressedSize;
    if (to > bytes.byteLength) {
      throw new Error("this archive is truncated");
    }

    const raw = bytes.subarray(from, to);
    const expanded =
      entry.method === METHOD_STORED ? raw : await inflate(raw, budget);

    budget -= expanded.byteLength;
    if (budget < 0) {
      throw new Error("this archive expands to more data than EIGA will read");
    }

    entries.push({ path: entry.path, text: decodeText(expanded) });
  }

  return { entries, ignored };
}
