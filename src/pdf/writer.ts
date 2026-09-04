import { encodeWinAnsi } from './metrics';

/**
 * The PDF container: indirect objects, streams and a cross-reference table.
 *
 * Written by hand for the same reason the zip packager is (scripts/package.mjs):
 * a PDF library is a large dependency to audit, and the subset a report needs
 * -- flowed text in three built-in fonts, JPEG images, one link -- is a couple
 * of hundred lines of well-specified file format. Nothing here touches the DOM,
 * so the whole thing is testable in Node.
 *
 * Byte offsets in the cross-reference table have to be exact or a reader
 * rejects the file outright, so the document is assembled as byte chunks whose
 * lengths are tracked as they are appended, never by re-measuring a string.
 */

/** A handle to an indirect object. Its number is fixed once reserved. */
export type PdfRef = { readonly id: number };

/**
 * Bytes for a string of PDF syntax.
 *
 * Latin-1, not UTF-8: a WinAnsi text string carries `é` as the single byte
 * 0xE9, and `TextEncoder` would write two. Getting this wrong produces a file
 * that opens and renders accented text as pairs of garbage glyphs.
 */
export function latin1(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/**
 * A literal PDF string, escaped and parenthesised.
 *
 * `(`, `)` and `\` are the three bytes that can end or reinterpret a string,
 * and an unescaped one in page copy would corrupt everything after it.
 */
export function pdfString(text: string): { literal: string; lost: number } {
  const { bytes, lost } = encodeWinAnsi(text);
  let out = '(';
  for (const byte of bytes) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += '\\';
    out += String.fromCharCode(byte);
  }
  return { literal: `${out})`, lost };
}

/**
 * A PDF *text string*, as UTF-16BE hex.
 *
 * This is not the same thing as `pdfString`, and the difference is a real bug
 * that shipped for an afternoon. Strings inside a content stream are decoded
 * through the font's encoding, which here is WinAnsi. Strings in the document
 * information dictionary are decoded as PDFDocEncoding instead -- a different
 * table in the same byte range -- so the em dash written as WinAnsi 0x97 came
 * out in Chrome's title bar as a capital S-caron.
 *
 * UTF-16BE with a byte-order mark sidesteps the question entirely, and has the
 * side benefit that the document title is correct for a page in any script,
 * even though the body text on that page cannot be.
 */
export function pdfTextString(text: string): string {
  let hex = 'FEFF';
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point > 0xffff) {
      // Outside the BMP: a surrogate pair, which is what UTF-16 is for.
      const offset = point - 0x10000;
      hex += (0xd800 + (offset >> 10)).toString(16).padStart(4, '0').toUpperCase();
      hex += (0xdc00 + (offset & 0x3ff)).toString(16).padStart(4, '0').toUpperCase();
      continue;
    }
    hex += point.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

/** `D:YYYYMMDDHHmmSSZ`, the date form every reader accepts. */
export function pdfDate(at: number): string {
  const date = new Date(at);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `D:${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

export class PdfDocument {
  /** Object bodies by number; index 0 is the unused free entry. */
  private readonly bodies: Array<Uint8Array | null> = [null];

  /** Claims an object number now and fills it in later. */
  reserve(): PdfRef {
    this.bodies.push(null);
    return { id: this.bodies.length - 1 };
  }

  define(ref: PdfRef, body: string | Uint8Array): void {
    this.bodies[ref.id] = typeof body === 'string' ? latin1(body) : body;
  }

  add(body: string | Uint8Array): PdfRef {
    const ref = this.reserve();
    this.define(ref, body);
    return ref;
  }

  /**
   * A stream object. `/Length` is written from the actual byte count rather
   * than an indirect reference, which keeps the file readable by anything and
   * makes a truncated stream impossible to write by accident.
   */
  addStream(dictionary: string, data: Uint8Array): PdfRef {
    const ref = this.reserve();
    this.defineStream(ref, dictionary, data);
    return ref;
  }

  defineStream(ref: PdfRef, dictionary: string, data: Uint8Array): void {
    const head = latin1(`<< ${dictionary} /Length ${data.length} >>\nstream\n`);
    const tail = latin1('\nendstream');
    const body = new Uint8Array(new ArrayBuffer(head.length + data.length + tail.length));
    body.set(head, 0);
    body.set(data, head.length);
    body.set(tail, head.length + data.length);
    this.define(ref, body);
  }

  get size(): number {
    return this.bodies.length;
  }

  /** Serialises the file. Every reserved object must have been defined. */
  build(root: PdfRef, info: PdfRef): Uint8Array<ArrayBuffer> {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    const append = (bytes: Uint8Array): void => {
      chunks.push(bytes);
      offset += bytes.length;
    };

    // The binary comment on line two tells transfer tools this is not text.
    append(latin1('%PDF-1.7\n'));
    append(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const offsets = new Array<number>(this.bodies.length).fill(0);
    for (let id = 1; id < this.bodies.length; id += 1) {
      const body = this.bodies[id];
      if (!body) throw new Error(`PDF object ${id} was reserved but never defined`);
      offsets[id] = offset;
      append(latin1(`${id} 0 obj\n`));
      append(body);
      append(latin1('\nendobj\n'));
    }

    const startxref = offset;
    // Each entry is exactly twenty bytes, including the trailing space, or the
    // table's fixed-width arithmetic stops working.
    let table = `xref\n0 ${this.bodies.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < this.bodies.length; id += 1) {
      table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    append(latin1(table));
    append(
      latin1(
        `trailer\n<< /Size ${this.bodies.length} /Root ${root.id} 0 R /Info ${info.id} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`,
      ),
    );

    const file = new Uint8Array(new ArrayBuffer(offset));
    let cursor = 0;
    for (const chunk of chunks) {
      file.set(chunk, cursor);
      cursor += chunk.length;
    }
    return file;
  }
}
