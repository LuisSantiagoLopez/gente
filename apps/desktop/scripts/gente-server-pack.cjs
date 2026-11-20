// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Windows: the server has paths longer than 260 characters (pnpm's store), which the NSIS
// installer cannot write; it silently drops those files. So the Windows app ships the server as
// one file, rakazo-server.pack, and the installer writes it out with Node (which handles long
// paths), restoring pnpm's links as directory junctions. The app does the same as self-repair if
// the folder is ever missing or incomplete.
//
// Format: 8-byte little-endian header length, a JSON header
// { files: [[relativePath, size, mode]], links: [[link, target]] }, then each file's bytes in order.
//   node gente-server-pack.cjs pack <server-dir> <pack-file>
//   node gente-server-pack.cjs unpack <pack-file> <server-dir>
const fs = require("node:fs");
const path = require("node:path");

const COMPLETE = ".complete";
const CHUNK = 1 << 20;

function pack(source, packFile) {
  const root = path.resolve(source);
  const files = [];
  const links = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        const real = path.resolve(path.dirname(full), fs.readlinkSync(full));
        if (!real.startsWith(root + path.sep) || !fs.statSync(real).isDirectory())
          throw new Error(`Server link ${rel} does not point to a folder inside the server`);
        links.push([rel, path.relative(root, real).split(path.sep).join("/")]);
      } else if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        files.push([rel, stat.size, stat.mode & 0o777]);
      }
    }
  };
  walk(root);
  const header = Buffer.from(JSON.stringify({ files, links }));
  const out = fs.openSync(packFile, "w");
  try {
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(header.length));
    fs.writeSync(out, length);
    fs.writeSync(out, header);
    for (const [rel] of files) fs.writeSync(out, fs.readFileSync(path.join(root, rel)));
  } finally {
    fs.closeSync(out);
  }
  return { files: files.length, links: links.length };
}

function readHeader(fd) {
  const length = Buffer.alloc(8);
  fs.readSync(fd, length, 0, 8, 0);
  const size = Number(length.readBigUInt64LE());
  const header = Buffer.alloc(size);
  fs.readSync(fd, header, 0, size, 8);
  return { header: JSON.parse(header.toString("utf8")), offset: 8 + size };
}

/** True when `dir` was fully written from this exact pack file. */
function isComplete(packFile, dir) {
  try {
    const stat = fs.statSync(packFile);
    return fs.readFileSync(path.join(dir, COMPLETE), "utf8") === `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return false;
  }
}

function unpack(packFile, target) {
  const root = path.resolve(target);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const fd = fs.openSync(packFile, "r");
  const buffer = Buffer.alloc(CHUNK);
  let links = [];
  let count = 0;
  try {
    const { header, offset } = readHeader(fd);
    links = header.links;
    let position = offset;
    const made = new Set();
    for (const [rel, size, mode] of header.files) {
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) throw new Error(`Pack entry outside the server: ${rel}`);
      const dir = path.dirname(file);
      if (!made.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        made.add(dir);
      }
      const out = fs.openSync(file, "w", mode || 0o644);
      try {
        let left = size;
        while (left > 0) {
          const read = fs.readSync(fd, buffer, 0, Math.min(CHUNK, left), position);
          if (read <= 0) throw new Error(`Pack ends early at ${rel}`);
          fs.writeSync(out, buffer, 0, read);
          position += read;
          left -= read;
        }
      } finally {
        fs.closeSync(out);
      }
      count++;
    }
  } finally {
    fs.closeSync(fd);
  }
  for (const [link, to] of links) {
    const at = path.resolve(root, link);
    const dest = path.resolve(root, to);
    if (!at.startsWith(root + path.sep) || !dest.startsWith(root + path.sep))
      throw new Error(`Pack link outside the server: ${link}`);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.symlinkSync(dest, at, process.platform === "win32" ? "junction" : "dir");
  }
  const stat = fs.statSync(packFile);
  fs.writeFileSync(path.join(root, COMPLETE), `${stat.size}:${Math.trunc(stat.mtimeMs)}`);
  return { files: count, links: links.length };
}

module.exports = { pack, unpack, isComplete, COMPLETE };

if (require.main === module) {
  const [command, from, to] = process.argv.slice(2);
  const started = Date.now();
  try {
    const result = command === "pack" ? pack(from, to) : command === "unpack" ? unpack(from, to) : null;
    if (!result) throw new Error("Usage: gente-server-pack.cjs pack|unpack <from> <to>");
    console.log(`${command}: ${result.files} files, ${result.links} links, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  }
}
