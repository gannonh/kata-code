/**
 * Minimal ustar tar writer shared by the repo seed archive and the credential
 * seed archive. Docker's `PUT /containers/{id}/archive` accepts an
 * uncompressed ustar tar; Node ships no `tar` module and the repo has no tar
 * dependency, so a ~60-line writer covers both seed paths.
 *
 * All entries (files and directories) carry the `katacode` uid/gid (100/101)
 * so Docker's archive extract creates katacode-owned files in the container —
 * no root-owned tree, no `git` dubious-ownership failure, no `chown` step.
 *
 * @module ustarWriter
 */

/** The katacode container user uid/gid (pinned in the Dockerfile). */
export const KATACODE_UID = 100;
export const KATACODE_GID = 101;

/** A file to pack: its in-archive relative path and the absolute host path to read from. */
export interface UstarFile {
  readonly relativePath: string;
  readonly absolutePath: string;
}

/** A pre-loaded file to pack: its in-archive relative path and the content bytes. */
export interface UstarContent {
  readonly relativePath: string;
  readonly content: Buffer;
}

/**
 * Pack the selected files into a ustar tar archive. Directory entries are
 * emitted (with katacode uid/gid) for every directory containing a selected
 * file so Docker's archive extract creates katacode-owned directories. The
 * archive ends with two 512-byte zero blocks.
 *
 * `files` are read from disk; `contents` are pre-loaded (used by the credential
 * seed for sanitized config files built in-memory). Both are packed the same
 * way; directory entries cover the union of all paths.
 */
export async function packUstarArchive(
  files: ReadonlyArray<UstarFile>,
  contents: ReadonlyArray<UstarContent> = [],
): Promise<Uint8Array> {
  const { readFile } = await import("node:fs/promises");
  const chunks: Buffer[] = [];

  // Directory entries are NOT emitted: Docker's `PUT /containers/{id}/archive`
  // calls `mkdir` for each directory entry and fails with "file exists" when
  // the directory already exists (e.g. from a previous seed or baked into the
  // image). Docker creates intermediate parent directories automatically when
  // extracting file entries. Ownership of intermediate directories is handled
  // by a post-extraction `chown -R` in the copyInto driver.

  // Pre-loaded contents first (sanitized configs), then disk-read files.
  for (const { relativePath, content } of contents) {
    chunks.push(makeUstarFileHeader(relativePath, content.length));
    chunks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
  }

  for (const { relativePath, absolutePath } of files) {
    const content = await readFile(absolutePath);
    chunks.push(makeUstarFileHeader(relativePath, content.length));
    chunks.push(content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad > 0) chunks.push(Buffer.alloc(pad, 0));
  }

  chunks.push(Buffer.alloc(1024, 0)); // two zero-block terminator
  return Buffer.concat(chunks);
}

/** Build a 512-byte ustar header for a regular file. */
export function makeUstarFileHeader(relativePath: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitUstarName(relativePath);
  name.copy(header, 0);
  if (prefix) prefix.copy(header, 345); // prefix (155)
  header.write("0000644\0", 100, "ascii"); // mode
  header.write(octal(KATACODE_UID, 7), 108, "ascii"); // uid
  header.write(octal(KATACODE_GID, 7), 116, "ascii"); // gid
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "ascii"); // size
  header.write("00000000000\0", 136, "ascii"); // mtime
  header.write("        ", 148, "ascii"); // checksum placeholder (8 spaces)
  header.write("0", 156, "ascii"); // typeflag: regular file
  header.write("ustar\0", 257, "ascii"); // magic
  header.write("00", 263, "ascii"); // version
  writeChecksum(header);
  return header;
}

/** Split a path into ustar name (100) + prefix (155) fields. Throws when both
 *  exceed their limits. */
function splitUstarName(relativePath: string): {
  readonly name: Buffer;
  readonly prefix: Buffer | null;
} {
  const nameBuf = Buffer.from(relativePath, "utf8");
  if (nameBuf.length <= 100) {
    return { name: nameBuf, prefix: null };
  }
  // Split at a `/` so the prefix ends at a path boundary. Try the longest
  // prefix (155 bytes) that leaves a name ≤ 100 bytes.
  for (let split = 155; split > 0; split--) {
    if (relativePath[split] !== "/") continue;
    const prefixStr = relativePath.slice(0, split);
    const nameStr = relativePath.slice(split + 1);
    const prefixBuf = Buffer.from(prefixStr, "utf8");
    const nameBuf2 = Buffer.from(nameStr, "utf8");
    if (prefixBuf.length <= 155 && nameBuf2.length <= 100 && nameStr.length > 0) {
      return { name: nameBuf2, prefix: prefixBuf };
    }
  }
  throw new Error(`ustar path too long for ustar name+prefix (>100+155 bytes): ${relativePath}`);
}

/** Build a 512-byte ustar header for a directory entry (typeflag 5, mode 0755). */
export function makeUstarDirectoryHeader(relativePath: string): Buffer {
  const header = makeUstarFileHeader(relativePath + "/", 0);
  header.write("5", 156, "ascii"); // typeflag: directory
  header.write("0000755\0", 100, "ascii"); // mode (dir: rwxr-xr-x)
  // Recompute the checksum since the typeflag and mode changed.
  header.write("        ", 148, "ascii"); // blank checksum field
  writeChecksum(header);
  return header;
}

/** Format a number as a zero-padded octal string with a NUL terminator. */
function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

/** Compute and write the ustar checksum (sum of all bytes with checksum field as spaces). */
function writeChecksum(header: Buffer): void {
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i] ?? 0;
  header.write(checksum.toString(8).padStart(6, "0"), 148, "ascii");
  header.write("\0 ", 154, "ascii"); // null + space terminator
}
