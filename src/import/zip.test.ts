import test from "node:test";
import assert from "node:assert/strict";

import { MAX_TOTAL_BYTES, readZip } from "./zip.ts";

/*
  These fixtures are real archives, built byte by byte, because the bug this
  module was written against is invisible to a mock. Letterboxd writes entries
  with general-purpose flag bit 3 set: the local file header's size fields are
  zeroed and the true sizes trail the data in a descriptor. A reader that takes
  sizes from local headers reads zero bytes per file and reports a successful
  import of nothing.

  So `streamed: true` below is not an edge case — it is the shape of every entry
  in the file this feature exists to read.
*/

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;

interface Entry {
  readonly path: string;
  readonly body: string | Uint8Array<ArrayBuffer>;
  readonly deflate?: boolean;
  /** Zero the local header's sizes and append a data descriptor, as Letterboxd does. */
  readonly streamed?: boolean;
  /** Overrides the method written to both headers, for the unsupported case. */
  readonly method?: number;
  /** OR-ed into the flags, for the encrypted case. */
  readonly flags?: number;
}

async function deflateRaw(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Builds a valid zip.
 *
 * CRCs are written as zero: the reader never checks them, and a fixture that
 * pretended otherwise would imply a guarantee this module does not make.
 */
async function buildZip(entries: readonly Entry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const raw =
      typeof entry.body === "string" ? encoder.encode(entry.body) : entry.body;
    const data = entry.deflate ? await deflateRaw(raw) : raw;
    const method = entry.method ?? (entry.deflate ? 8 : 0);
    const flags = (entry.streamed ? 0x0008 : 0) | (entry.flags ?? 0);

    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIGNATURE, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, entry.streamed ? 0 : data.length, true);
    lv.setUint32(22, entry.streamed ? 0 : raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    parts.push(local);

    if (entry.streamed) {
      const descriptor = new Uint8Array(16);
      const dv = new DataView(descriptor.buffer);
      dv.setUint32(0, DESCRIPTOR_SIGNATURE, true);
      dv.setUint32(8, data.length, true);
      dv.setUint32(12, raw.length, true);
      parts.push(descriptor);
    }

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIGNATURE, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);

    offset += local.length + (entry.streamed ? 16 : 0);
  }

  const centralSize = directory.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIGNATURE, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...directory, eocd]);
}

const everything = () => true;

async function bytesOf(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

test("reads entries whose local headers declare no sizes", async () => {
  /*
    The regression. Every entry here is streamed and deflated, exactly as a real
    Letterboxd export writes them. Taking sizes from the local header yields
    empty strings and a silently empty library.
  */
  const zip = await buildZip([
    { path: "diary.csv", body: "Name,Year\nStalker,1979\n", deflate: true, streamed: true },
    { path: "watched.csv", body: "Name,Year\nSolaris,1972\n", deflate: true, streamed: true },
  ]);

  const read = await readZip(zip, everything);

  assert.deepEqual(
    read.entries.map((entry) => entry.path),
    ["diary.csv", "watched.csv"],
  );
  assert.equal(read.entries[0].text, "Name,Year\nStalker,1979\n");
  assert.equal(read.entries[1].text, "Name,Year\nSolaris,1972\n");
  assert.equal(read.ignored, 0);
});

test("reads stored entries as well as deflated ones", async () => {
  const zip = await buildZip([
    { path: "stored.csv", body: "Name\nStored\n" },
    { path: "deflated.csv", body: "Name\nDeflated\n", deflate: true },
  ]);

  const read = await readZip(zip, everything);
  const texts = read.entries.map((entry) => entry.text).sort();
  assert.deepEqual(texts, ["Name\nDeflated\n", "Name\nStored\n"]);
});

test("entries the caller refuses are never decompressed", async () => {
  /*
    `junk.csv` claims to be deflated but its body is not a deflate stream, so
    inflating it throws. The read succeeding is the proof that a refused entry is
    skipped rather than expanded and discarded — which matters because the caller
    refuses `profile.csv`, and expanding a file EIGA has promised not to read
    would break that promise even if the bytes went nowhere.
  */
  const zip = await buildZip([
    { path: "diary.csv", body: "Name\nStalker\n", deflate: true, streamed: true },
    { path: "junk.csv", body: "not a deflate stream at all", method: 8 },
  ]);

  const read = await readZip(zip, (path) => path === "diary.csv");

  assert.deepEqual(
    read.entries.map((entry) => entry.path),
    ["diary.csv"],
  );
  assert.equal(read.ignored, 1);
});

test("nested paths reach the caller intact", async () => {
  /*
    A real export contains `likes/films.csv`, which EIGA wants, alongside
    `deleted/diary.csv` and `orphaned/diary.csv`, which it must not treat as
    viewings. Flattening paths here would make those indistinguishable from
    `diary.csv` and import deleted entries as real ones.
  */
  const zip = await buildZip([
    { path: "likes/films.csv", body: "Name\nLiked\n", deflate: true, streamed: true },
    { path: "deleted/diary.csv", body: "Name\nDeleted\n", deflate: true, streamed: true },
  ]);

  const read = await readZip(zip, everything);
  assert.deepEqual(
    read.entries.map((entry) => entry.path).sort(),
    ["deleted/diary.csv", "likes/films.csv"],
  );
});

test("directory markers are counted, not read", async () => {
  const zip = await buildZip([
    { path: "likes/", body: "" },
    { path: "likes/films.csv", body: "Name\nLiked\n", deflate: true, streamed: true },
  ]);

  const read = await readZip(zip, everything);
  assert.equal(read.entries.length, 1);
  assert.equal(read.ignored, 1);
});

test("a byte-order mark is stripped from entry text", async () => {
  // Left in place it becomes part of the first header name, so `Date` stops
  // matching and every column in the file is read as missing.
  const zip = await buildZip([
    { path: "diary.csv", body: "﻿Date,Name\n2024-01-01,Stalker\n", deflate: true },
  ]);

  const read = await readZip(zip, everything);
  assert.ok(read.entries[0].text.startsWith("Date,Name"));
});

test("zip64 archives are refused rather than misread", async () => {
  const zip = await buildZip([{ path: "diary.csv", body: "Name\nStalker\n" }]);
  const bytes = await bytesOf(zip);

  // Overwrite the EOCD's central-directory offset with the zip64 sentinel.
  const eocd = bytes.byteLength - 22;
  new DataView(bytes.buffer).setUint32(eocd + 16, 0xffffffff, true);

  await assert.rejects(
    () => readZip(new Blob([bytes]), everything),
    /zip64/,
  );
});

test("unsupported compression methods and encryption are refused when read", async () => {
  const compressed = await buildZip([
    { path: "diary.csv", body: "Name\nStalker\n", method: 99 },
  ]);
  await assert.rejects(() => readZip(compressed, everything), /compression method/);

  const encrypted = await buildZip([
    { path: "diary.csv", body: "Name\nStalker\n", flags: 0x0001 },
  ]);
  await assert.rejects(() => readZip(encrypted, everything), /encrypted/);
});

test("an unreadable entry the caller does not want is harmless", async () => {
  // The counterpart to the test above: an export containing one encrypted file
  // EIGA has no interest in must still import.
  const zip = await buildZip([
    { path: "diary.csv", body: "Name\nStalker\n", deflate: true, streamed: true },
    { path: "secret.bin", body: "encrypted bytes", flags: 0x0001 },
  ]);

  const read = await readZip(zip, (path) => path.endsWith(".csv"));
  assert.equal(read.entries.length, 1);
  assert.equal(read.ignored, 1);
});

test("the decompressed size cap holds against an archive that lies about it", async () => {
  /*
    A zip bomb in miniature: highly compressible data whose expanded size
    exceeds the budget. The cap must be enforced against bytes actually
    produced, not against the size the archive declares, because the
    declaration is the part an attacker controls.
  */
  const huge = new Uint8Array(MAX_TOTAL_BYTES + 1024 * 1024);
  const zip = await buildZip([
    { path: "diary.csv", body: huge, deflate: true, streamed: true },
  ]);

  assert.ok(zip.size < 1024 * 1024, "fixture should compress small");
  await assert.rejects(() => readZip(zip, everything), /more data than/);
});

test("a file that is not a zip is refused", async () => {
  const notAZip = new Blob(["Date,Name,Year\n2024-01-01,Stalker,1979\n"]);
  await assert.rejects(() => readZip(notAZip, everything), /not a readable zip/);
});

test("a truncated archive is refused", async () => {
  const zip = await buildZip([
    { path: "diary.csv", body: "Name\nStalker\n", deflate: true, streamed: true },
  ]);
  const bytes = await bytesOf(zip);

  // Point the first entry's local header past the end of the file.
  const eocd = bytes.byteLength - 22;
  const view = new DataView(bytes.buffer);
  const centralOffset = view.getUint32(eocd + 16, true);
  view.setUint32(centralOffset + 42, bytes.byteLength - 4, true);

  await assert.rejects(
    () => readZip(new Blob([bytes]), everything),
    /truncated|malformed/,
  );
});

test("reading the same archive twice gives the same result", async () => {
  const zip = await buildZip([
    { path: "diary.csv", body: "Name\nStalker\n", deflate: true, streamed: true },
    { path: "likes/films.csv", body: "Name\nLiked\n", deflate: true, streamed: true },
  ]);

  const first = await readZip(zip, everything);
  const second = await readZip(zip, everything);
  assert.deepEqual(first, second);
});
