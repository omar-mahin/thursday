import { BASE_FONTS, measure, type PdfFont, wrap } from './metrics';
import { latin1, PdfDocument, pdfDate, pdfString, pdfTextString, type PdfRef } from './writer';

/**
 * A one-column flowing layout over paged canvas.
 *
 * Enough of a typesetter for a report and no more: a cursor that runs down the
 * page, blocks that ask for the room they need before they start drawing, and
 * a page break when the room is not there. There is no reflow and no widow
 * control, because a report is read top to bottom rather than designed.
 *
 * `finish` is where page numbers are stamped, since "page 3 of 11" is not
 * knowable until the last block has been placed.
 */

/** RGB, each channel 0-1, as PDF operators want it. */
export type PdfColor = readonly [number, number, number];

export const BLACK: PdfColor = [0.08, 0.09, 0.11];
export const DIM: PdfColor = [0.36, 0.39, 0.44];
export const RULE: PdfColor = [0.84, 0.86, 0.9];
export const PALE: PdfColor = [0.97, 0.97, 0.98];

/** A4 in points, the size a report is most likely to be printed on. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 48;
/** Reserved at the foot of every page for the running footer. */
export const FOOTER = 30;

export type PdfImage = {
  /** JPEG bytes, embedded as-is through DCTDecode. */
  jpeg: Uint8Array;
  width: number;
  height: number;
};

export type TextOptions = {
  font?: PdfFont;
  size?: number;
  color?: PdfColor;
  /** Extra indent from the left margin. */
  indent?: number;
  /** Space above the block. Collapsed away at the top of a page. */
  before?: number;
  after?: number;
  /** Line height as a multiple of the size. */
  leading?: number;
  /** Narrower measure than the column, for a nested block. */
  width?: number;
};

type PendingLink = { rect: readonly [number, number, number, number]; url: string };

/** Handle returned by `beginPanel`, so the fill lands on the right page. */
export type PanelToken = { page: Page; top: number };

type Page = {
  content: string[];
  links: PendingLink[];
};

const round = (value: number): string => (Math.round(value * 100) / 100).toString();

export class PdfLayout {
  private readonly pages: Page[] = [];
  private page: Page;
  /** Distance from the top of the page to the next block. */
  private cursor = MARGIN;
  private readonly images = new Map<PdfImage, PdfRef>();
  /** Characters no base-14 font could represent, across the whole document. */
  private lostCharacters = 0;

  constructor(private readonly doc: PdfDocument) {
    this.page = { content: [], links: [] };
    this.pages.push(this.page);
  }

  get lost(): number {
    return this.lostCharacters;
  }

  get columnWidth(): number {
    return PAGE_WIDTH - MARGIN * 2;
  }

  /** Room left before the footer zone. */
  private get remaining(): number {
    return PAGE_HEIGHT - FOOTER - MARGIN - this.cursor;
  }

  private get atPageTop(): boolean {
    return this.cursor === MARGIN;
  }

  /** Distance from the top of the current page to the next block. */
  get top(): number {
    return this.cursor;
  }

  private newPage(): void {
    this.page = { content: [], links: [] };
    this.pages.push(this.page);
    this.cursor = MARGIN;
  }

  /** Starts a new page unless `height` still fits on this one. */
  ensure(height: number): void {
    if (this.atPageTop) return;
    if (height <= this.remaining) return;
    this.newPage();
  }

  gap(height: number): void {
    if (this.atPageTop) return;
    this.cursor += height;
  }

  /** Height a text block would occupy, for `ensure`. */
  heightOf(text: string, options: TextOptions = {}): number {
    const size = options.size ?? 10;
    const leading = options.leading ?? 1.35;
    const width = (options.width ?? this.columnWidth) - (options.indent ?? 0);
    const lines = wrap(text, options.font ?? 'regular', size, width).length;
    return (options.before ?? 0) + lines * size * leading + (options.after ?? 0);
  }

  /**
   * Draws wrapped text, breaking pages between lines when it has to.
   *
   * A block longer than a whole page -- a pasted stack trace in a note --
   * continues onto the next rather than being clipped, which is why the page
   * break lives inside the per-line loop.
   */
  text(text: string, options: TextOptions = {}): void {
    const font = options.font ?? 'regular';
    const size = options.size ?? 10;
    const leading = options.leading ?? 1.35;
    const indent = options.indent ?? 0;
    const color = options.color ?? BLACK;
    const width = (options.width ?? this.columnWidth) - indent;
    const step = size * leading;

    this.gap(options.before ?? 0);
    for (const line of wrap(text, font, size, width)) {
      if (step > this.remaining && !this.atPageTop) this.newPage();
      if (line !== '') {
        this.draw(line, MARGIN + indent, this.baseline(size, step), font, size, color);
      }
      this.cursor += step;
    }
    this.cursor += options.after ?? 0;
  }

  /**
   * A label and a value on one line, the label in a fixed-width gutter.
   *
   * Used for the report's metadata. The value wraps under itself rather than
   * under the label, so a long URL does not run back into the gutter.
   */
  keyValue(label: string, value: string, gutter = 96, size = 9.5): void {
    const step = size * 1.4;
    this.ensure(step);
    const lines = wrap(value, 'regular', size, this.columnWidth - gutter);
    const baseline = this.baseline(size, step);
    this.draw(label, MARGIN, baseline, 'bold', size, DIM);
    for (let index = 0; index < Math.max(1, lines.length); index += 1) {
      if (index > 0 && step > this.remaining) this.newPage();
      const line = lines[index] ?? '';
      if (line) this.draw(line, MARGIN + gutter, this.baseline(size, step), 'regular', size, BLACK);
      this.cursor += step;
    }
  }

  /** A horizontal rule across the column. */
  rule(color: PdfColor = RULE, thickness = 0.75): void {
    this.ensure(thickness + 6);
    this.cursor += 3;
    const y = PAGE_HEIGHT - this.cursor;
    this.page.content.push(
      `${color[0]} ${color[1]} ${color[2]} RG ${thickness} w ${round(MARGIN)} ${round(y)} m ${round(
        PAGE_WIDTH - MARGIN,
      )} ${round(y)} l S`,
    );
    this.cursor += thickness + 3;
  }

  /**
   * Opens a tinted panel behind whatever is drawn next.
   *
   * The fill has to be emitted before the text it sits behind, but its height
   * is not known until the text has been placed -- hence the two calls, with
   * the rectangle spliced in at the front of the page's operators when it
   * closes. If the block broke across a page the panel is dropped rather than
   * drawn on the wrong one: a stray stripe reads as a rendering bug, while a
   * missing tint reads as nothing at all.
   */
  beginPanel(): PanelToken {
    return { page: this.page, top: this.cursor };
  }

  endPanel(token: PanelToken, color: PdfColor = PALE, padding = 5): void {
    if (token.page !== this.page) return;
    const height = this.cursor - token.top + padding * 2;
    if (height <= 0) return;
    const y = PAGE_HEIGHT - token.top - height + padding;
    token.page.content.unshift(
      `${color[0]} ${color[1]} ${color[2]} rg ${round(MARGIN - 6)} ${round(y)} ${round(
        this.columnWidth + 12,
      )} ${round(height)} re f`,
    );
  }

  /**
   * A small filled badge with a label in it -- the severity marker.
   *
   * Returns its width and deliberately does not advance the cursor: it is
   * drawn to sit beside the heading that follows it, and that heading's own
   * line is what moves the layout on.
   */
  badge(label: string, fill: PdfColor, size = 7.5): number {
    const padding = 4.5;
    const textWidth = measure(label, 'bold', size);
    const width = textWidth + padding * 2;
    const height = size + 5;
    const step = height;
    this.ensure(step);
    const y = PAGE_HEIGHT - this.cursor - height;
    this.page.content.push(
      `${fill[0]} ${fill[1]} ${fill[2]} rg ${round(MARGIN)} ${round(y)} ${round(width)} ${round(height)} re f`,
    );
    this.draw(label, MARGIN + padding, y + 3.6, 'bold', size, [1, 1, 1]);
    return width;
  }

  /**
   * Places an image, scaled to fit the column and whatever height is left.
   *
   * A crop that cannot fit on the remainder of a page moves to the next one
   * whole; scaling it down to squeeze in would make evidence unreadable to
   * save a page break.
   */
  place(image: PdfImage, options: { maxHeight?: number; caption?: string } = {}): void {
    if (image.width <= 0 || image.height <= 0) return;
    const ceiling = Math.min(options.maxHeight ?? 320, PAGE_HEIGHT - MARGIN * 2 - FOOTER);
    const scale = Math.min(this.columnWidth / image.width, ceiling / image.height, 1);
    const width = image.width * scale;
    const height = image.height * scale;
    const captionHeight = options.caption ? this.heightOf(options.caption, { size: 8.5 }) : 0;

    this.ensure(height + captionHeight + 8);
    const name = this.register(image);
    const y = PAGE_HEIGHT - this.cursor - height;
    this.page.content.push(
      `q ${round(width)} 0 0 ${round(height)} ${round(MARGIN)} ${round(y)} cm /${name} Do Q`,
    );
    // A hairline border, so a screenshot with white edges still reads as an
    // image rather than as a gap in the page.
    this.page.content.push(
      `${RULE[0]} ${RULE[1]} ${RULE[2]} RG 0.5 w ${round(MARGIN)} ${round(y)} ${round(width)} ${round(
        height,
      )} re S`,
    );
    this.cursor += height + 3;
    if (options.caption) this.text(options.caption, { size: 8.5, color: DIM, after: 4 });
  }

  /** An http(s) link over a text block that was just drawn. */
  link(url: string, height: number, width: number): void {
    const top = this.cursor - height;
    this.page.links.push({
      rect: [MARGIN, PAGE_HEIGHT - this.cursor, MARGIN + width, PAGE_HEIGHT - top],
      url,
    });
  }

  private baseline(size: number, step: number): number {
    // Sits the glyphs on the line box rather than on its top edge.
    return PAGE_HEIGHT - this.cursor - size * 0.82 - (step - size) / 2;
  }

  private draw(
    text: string,
    x: number,
    baseline: number,
    font: PdfFont,
    size: number,
    color: PdfColor,
  ): void {
    const { literal, lost } = pdfString(text);
    this.lostCharacters += lost;
    this.page.content.push(
      `BT ${color[0]} ${color[1]} ${color[2]} rg /${fontName(font)} ${round(size)} Tf 1 0 0 1 ${round(
        x,
      )} ${round(baseline)} Tm ${literal} Tj ET`,
    );
  }

  /**
   * Adds an image XObject once, however many times the same image is placed.
   *
   * Keyed on the object, not on its bytes. A content hash would be the tidier
   * answer if two callers could produce equal images independently, and here
   * they cannot: every image comes from one prepared map, so identity is both
   * exact and free -- where a cheap hash of length and end bytes would happily
   * collide two crops of the same blank region.
   */
  private register(image: PdfImage): string {
    const existing = this.images.get(image);
    if (existing) return nameFor(existing);
    const ref = this.doc.addStream(
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      image.jpeg,
    );
    this.images.set(image, ref);
    return nameFor(ref);
  }

  /**
   * Closes the document: stamps footers, writes the page tree and returns the
   * file.
   *
   * Content streams are left uncompressed. Flate would shrink the text by
   * roughly five to one, but the text is the small part -- embedded crops
   * dominate a real report and are already compressed -- and an uncompressed
   * stream is one that can be read with `strings` when something looks wrong.
   */
  finish(meta: { title: string; author: string; subject: string; createdAt: number }): Uint8Array<ArrayBuffer> {
    const fonts = new Map<PdfFont, PdfRef>();
    for (const font of ['regular', 'bold', 'mono'] as const) {
      fonts.set(
        font,
        this.doc.add(
          `<< /Type /Font /Subtype /Type1 /BaseFont /${BASE_FONTS[font]} /Encoding /WinAnsiEncoding >>`,
        ),
      );
    }

    const resources = `<< /Font << ${[...fonts.entries()]
      .map(([font, ref]) => `/${fontName(font)} ${ref.id} 0 R`)
      .join(' ')} >>${
      this.images.size > 0
        ? ` /XObject << ${[...this.images.values()].map((ref) => `/${nameFor(ref)} ${ref.id} 0 R`).join(' ')} >>`
        : ''
    } >>`;

    const pagesRef = this.doc.reserve();
    const pageRefs: PdfRef[] = [];
    const total = this.pages.length;

    for (let index = 0; index < total; index += 1) {
      const page = this.pages[index];
      if (!page) continue;
      this.stampFooter(page, index + 1, total, meta.author);
      const contentRef = this.doc.addStream('', latin1(page.content.join('\n')));
      const annotations = page.links.map((link) => {
        const target = this.doc.add(
          `<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [${link.rect
            .map(round)
            .join(' ')}] /A << /S /URI /URI ${pdfString(link.url).literal} >> >>`,
        );
        return `${target.id} 0 R`;
      });
      pageRefs.push(
        this.doc.add(
          `<< /Type /Page /Parent ${pagesRef.id} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${
            contentRef.id
          } 0 R${annotations.length > 0 ? ` /Annots [${annotations.join(' ')}]` : ''} >>`,
        ),
      );
    }

    this.doc.define(
      pagesRef,
      `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref.id} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`,
    );
    const root = this.doc.add(`<< /Type /Catalog /Pages ${pagesRef.id} 0 R >>`);
    // Text strings, not content-stream strings: see pdfTextString.
    const info = this.doc.add(
      `<< /Title ${pdfTextString(meta.title)} /Author ${pdfTextString(meta.author)} /Subject ${pdfTextString(
        meta.subject,
      )} /Producer ${pdfTextString(meta.author)} /CreationDate (${pdfDate(meta.createdAt)}) >>`,
    );
    return this.doc.build(root, info);
  }

  private stampFooter(page: Page, number: number, total: number, author: string): void {
    const size = 8;
    const y = MARGIN * 0.55;
    const left = pdfString(author);
    const right = pdfString(`Page ${number} of ${total}`);
    this.lostCharacters += left.lost + right.lost;
    page.content.push(
      `${RULE[0]} ${RULE[1]} ${RULE[2]} RG 0.5 w ${round(MARGIN)} ${round(y + size + 6)} m ${round(
        PAGE_WIDTH - MARGIN,
      )} ${round(y + size + 6)} l S`,
      `BT ${DIM[0]} ${DIM[1]} ${DIM[2]} rg /F1 ${size} Tf 1 0 0 1 ${round(MARGIN)} ${round(y)} Tm ${
        left.literal
      } Tj ET`,
      `BT ${DIM[0]} ${DIM[1]} ${DIM[2]} rg /F1 ${size} Tf 1 0 0 1 ${round(
        PAGE_WIDTH - MARGIN - measure(`Page ${number} of ${total}`, 'regular', size),
      )} ${round(y)} Tm ${right.literal} Tj ET`,
    );
  }
}

const fontName = (font: PdfFont): string =>
  font === 'regular' ? 'F1' : font === 'bold' ? 'F2' : 'F3';

const nameFor = (ref: PdfRef): string => `Im${ref.id}`;
