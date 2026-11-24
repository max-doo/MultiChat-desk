/**
 * Command-output text encoding — one decode policy for every spawned tool.
 *
 * Decode chain: UTF-16LE (NUL detection) → strict UTF-8 → system ANSI code
 * page, per line. A user's own tooling overwhelmingly emits its machine's
 * ANSI code page (GBK on zh-CN), which makes that fallback deterministic
 * rather than a statistical guess. Ported from WebAI-to-API's
 * agent/src/encoding.ts; file-IO encode helpers were dropped (pi's own
 * read/write tools handle file encoding).
 */

import { execFile, execFileSync } from "node:child_process";
import { promisify, TextDecoder } from "node:util";

const execFileAsync = promisify(execFile);

/** Mirrors the server's MAX_TEXT_CONTROL_CHAR_RATIO (multimodal.py). */
const TEXT_CONTROL_CHAR_RATIO = 0.01;
const ENCODING_SNIFF_BYTES = 64 * 1024;

/** Map a Windows code page number to a WHATWG encoding label. */
export function codePageToLabel(cp: number): string | null {
  if (cp === 65001) return null; // UTF-8 console — fallback decoding adds nothing
  if (cp === 936 || cp === 54936) return "gbk"; // GB18030 superset shares the gbk decoder
  if (cp === 950) return "big5";
  if (cp === 932) return "shift_jis";
  if (cp === 949) return "euc-kr"; // unified-hangul superset
  if (cp === 866) return "ibm866";
  if (cp === 874) return "windows-874";
  if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
  return "windows-1252"; // 437/850/other OEM — closest available label
}

/**
 * Decode one captured child-process stream. Strict UTF-8 first; on failure,
 * retry PER LINE (UTF-8 lines stay intact in mixed-encoding output — common
 * when a UTF-8 tool and a code-page tool share a stream). Lines are a safe
 * unit: GBK/Big5/Shift_JIS/EUC-KR trail bytes never equal 0x0A, so a line
 * boundary can never split their multi-byte sequences.
 */
export function decodeCommandOutput(buf: Buffer, fallback: TextDecoder | null): string {
  if (buf.length === 0) return "";
  // UTF-16LE (PowerShell Out-File, cmd /u): every ASCII char carries a NUL,
  // which is ALSO valid UTF-8 — the strict pass below would "succeed" on
  // NUL-stuffed garbage. Detect NUL first.
  if (buf.includes(0)) {
    try {
      return new TextDecoder("utf-16le", { fatal: true }).decode(buf);
    } catch {
      // not UTF-16 — fall through to the UTF-8 path
    }
  }
  const strict = new TextDecoder("utf-8", { fatal: true });
  try {
    return strict.decode(buf);
  } catch {
    if (fallback === null) return new TextDecoder("utf-8").decode(buf);
  }
  const lines: string[] = [];
  for (let start = 0, i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === 0x0a) {
      const seg = buf.subarray(start, i);
      try {
        lines.push(strict.decode(seg));
      } catch {
        lines.push(fallback.decode(seg));
      }
      start = i + 1;
    }
  }
  return lines.join("\n");
}

// ─── code-page probing (Windows only; POSIX resolves null) ───────────────────

let fallbackDecoderPromise: Promise<TextDecoder | null> | null = null;
let fallbackDecoderSync: TextDecoder | null | undefined;

/** Async probe — pre-fired by the bash tool so it overlaps the child. */
export function getFallbackDecoder(): Promise<TextDecoder | null> {
  if (process.platform !== "win32") return Promise.resolve(null);
  return (fallbackDecoderPromise ??= probeFallbackDecoder());
}

/** Sync probe for the file tools — one ~40ms registry read, cached. */
export function getFallbackDecoderSync(): TextDecoder | null {
  if (process.platform !== "win32") return null;
  if (fallbackDecoderSync === undefined) {
    fallbackDecoderSync = probeCodePagesSync();
  }
  return fallbackDecoderSync;
}

/**
 * Candidate code pages for this machine: ANSI first (piped tools like
 * Python write in it), then OEM. One registry read supplies both and needs
 * no console attachment; chcp is the last-resort probe.
 */
function probeCodePagesSync(): TextDecoder | null {
  const cps = probeCodePageNumbers();
  for (const cp of cps) {
    const label = codePageToLabel(cp);
    if (!label) continue;
    try {
      return new TextDecoder(label);
    } catch {
      // small-icu build lacks the label — try next
    }
  }
  try {
    return new TextDecoder("gbk");
  } catch {
    return null;
  }
}

function probeCodePageNumbers(): number[] {
  const cps: number[] = [];
  try {
    const out = execFileSync(
      "reg.exe",
      ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage"],
      { encoding: "buffer" },
    ).toString("latin1");
    const acp = /^\s*ACP\s+REG_SZ\s+(\d+)/m.exec(out);
    const oemcp = /^\s*OEMCP\s+REG_SZ\s+(\d+)/m.exec(out);
    for (const m of [acp, oemcp]) if (m) cps.push(Number(m[1]));
  } catch {
    // reg.exe missing (stripped-down Windows) — try chcp below.
  }
  if (cps.length === 0) {
    try {
      const out = execFileSync("cmd.exe", ["/d", "/c", "chcp"], { encoding: "buffer" })
        .toString("latin1")
        .trim();
      const m = /(\d+)\s*$/.exec(out);
      if (m) cps.push(Number(m[1]));
    } catch {
      // no probe available
    }
  }
  return cps;
}

async function probeFallbackDecoder(): Promise<TextDecoder | null> {
  const cps: number[] = [];
  try {
    const { stdout } = await execFileAsync(
      "reg.exe",
      ["query", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Nls\\CodePage"],
      { encoding: "buffer" },
    );
    const text = stdout.toString("latin1");
    const acp = /^\s*ACP\s+REG_SZ\s+(\d+)/m.exec(text);
    const oemcp = /^\s*OEMCP\s+REG_SZ\s+(\d+)/m.exec(text);
    for (const m of [acp, oemcp]) if (m) cps.push(Number(m[1]));
  } catch {
    // reg.exe missing (stripped-down Windows) — try chcp below.
  }
  if (cps.length === 0) {
    try {
      const { stdout } = await execFileAsync("cmd.exe", ["/d", "/c", "chcp"], {
        encoding: "buffer",
      });
      const m = /(\d+)\s*$/.exec(stdout.toString("latin1").trim());
      if (m) cps.push(Number(m[1]));
    } catch {
      // no probe available
    }
  }
  for (const cp of cps) {
    const label = codePageToLabel(cp);
    if (!label) continue;
    try {
      return new TextDecoder(label);
    } catch {
      // small-icu build lacks the label — try next
    }
  }
  try {
    return new TextDecoder("gbk");
  } catch {
    return null;
  }
}

/**
 * Resolve a user-supplied `encoding` argument: WHATWG label ("gbk",
 * "utf-16le", "windows-1252") or a Windows code-page number ("936").
 * Returns null for unrecognized input.
 */
export function resolveDecoder(encoding: string | undefined): TextDecoder | null {
  const raw = (encoding ?? "").trim().toLowerCase();
  if (raw === "") return null;
  const label = /^\d+$/.test(raw) ? codePageToLabel(Number(raw)) : raw;
  if (!label) return null;
  try {
    return new TextDecoder(label === "utf8" ? "utf-8" : label);
  } catch {
    return null;
  }
}

function isControlChar(code: number): boolean {
  if (code === 9 || code === 10 || code === 11 || code === 12 || code === 13) return false;
  return code < 32 || code === 127;
}

/** Binary heuristic on the DECODED text — mirrors isTextLike's contract. */
export function looksBinary(text: string): boolean {
  if (text.includes("\x00")) return true;
  const probe = text.length > ENCODING_SNIFF_BYTES ? text.slice(0, ENCODING_SNIFF_BYTES) : text;
  if (probe.length === 0) return false;
  let controls = 0;
  for (const ch of probe) if (isControlChar(ch.codePointAt(0)!)) controls++;
  return controls / probe.length > TEXT_CONTROL_CHAR_RATIO;
}
