import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString, PDFContentStream,
  PDFString, rgb, degrees, drawText, pushGraphicsState, popGraphicsState,
  setGraphicsState, setFillingRgbColor, setStrokingRgbColor, rectangle, fill,
  moveTo, lineTo, stroke, setLineWidth, setLineCap, LineCapStyle,
  type PDFFont, type PDFOperator,
} from 'pdf-lib';
import { fontStyle, type Annotation, type FontStyle } from './model';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };
export type PageInfo = { page: pdfjs.PDFPageProxy; width: number; height: number };
const key = PDFName.of('PaperlineData');
const fontPaths: Record<FontStyle, string> = { regular: 'Regular', bold: 'Bold', italic: 'Italic', boldItalic: 'BoldItalic' };
const fontCache = new Map<string, Promise<ArrayBuffer>>();
const fontData = (style: FontStyle) => {
  if (!fontCache.has(style)) fontCache.set(style, fetch(`fonts/NotoSans-${fontPaths[style]}.ttf`).then(r => { if (!r.ok) throw Error('Could not load the local font.'); return r.arrayBuffer(); }));
  return fontCache.get(style)!;
};

// Native PDF annotations carry both their appearance and editable Paperline data.
// Removing only our own annotations gives a clean base for each new edit session.
export async function readPdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annotations: Annotation[] = [];
  for (const [index, page] of doc.getPages().entries()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const entry = doc.context.lookup(annots.get(i));
      if (!(entry instanceof PDFDict)) continue;
      const data = entry.get(key);
      if (!(data instanceof PDFHexString || data instanceof PDFString)) continue;
      try {
        const a = JSON.parse(data.decodeText()) as Annotation;
        if (!isAnnotation(a)) continue;
        a.page = index; annotations.unshift(a); annots.remove(i);
      } catch { /* An unknown or malformed annotation stays in the PDF. */ }
    }
  }
  const cleanBytes = annotations.length ? await doc.save() : bytes;
  const task = pdfjs.getDocument({
    data: cleanBytes.slice(),
    cMapUrl: new URL('pdfjs/cmaps/', location.href).href, cMapPacked: true,
    standardFontDataUrl: new URL('pdfjs/standard_fonts/', location.href).href,
    iccUrl: new URL('pdfjs/iccs/', location.href).href,
    wasmUrl: new URL('pdfjs/wasm/', location.href).href,
  });
  const pdf = await task.promise;
  const pages: PageInfo[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ page, width: viewport.width, height: viewport.height });
  }
  return { pdf, pages, annotations, bytes: cleanBytes };
}

function isAnnotation(a: Annotation) {
  return a && ['text', 'highlight', 'draw'].includes(a.kind) && typeof a.id === 'string' &&
    typeof a.text === 'string' && a.text.length < 100000 &&
    /^#[\da-f]{6}$/i.test(a.color) && ['left', 'center', 'right'].includes(a.align) &&
    typeof a.bold === 'boolean' && typeof a.italic === 'boolean' &&
    [a.x, a.y, a.width, a.height, a.size].every(n => Number.isFinite(n) && Math.abs(n) < 100000) &&
    a.width > 0 && a.height > 0 && a.size >= 6 && a.size <= 96 &&
    (!a.points || (a.points.length <= 100000 && a.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))));
}

// One wrapping algorithm drives the editor and the exported appearance stream.
export function wrapText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (!word) continue;
      const candidate = line + word;
      if (line && measure(candidate.trimEnd()) > width) { lines.push(line.trimEnd()); line = ''; }
      if (!line && /^\s+$/.test(word)) continue;
      if (measure(word) > width) {
        for (const char of word) {
          if (line && measure(line + char) > width) { lines.push(line); line = ''; }
          line += char;
        }
      } else line += word;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

let measureCanvas: HTMLCanvasElement | undefined;
export function textLayout(a: Annotation) {
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d')!;
  ctx.font = `${a.italic ? 'italic' : 'normal'} ${a.bold ? 700 : 400} ${a.size}px 'Noto Sans'`;
  // PDF fontkit does not apply browser kerning. Disable it in both views.
  ctx.fontKerning = 'none';
  const lines = wrapText(a.text, Math.max(12, a.width - 12), t => ctx.measureText(t).width);
  return { lines, height: Math.max(a.size * 1.45 + 12, lines.length * a.size * 1.45 + 12) };
}

export async function exportPdf(bytes: Uint8Array, annotations: Annotation[], pages: PageInfo[]) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { default: fontkit } = await import('@pdf-lib/fontkit');
  doc.registerFontkit(fontkit);
  const fonts = new Map<FontStyle, PDFFont>();
  for (const a of annotations) {
    if (a.kind !== 'text' || !a.text.trim()) continue;
    const style = fontStyle(a);
    if (!fonts.has(style)) fonts.set(style, await doc.embedFont(await fontData(style), { subset: true }));
  }
  for (const a of annotations) {
    if (a.kind === 'text' && !a.text.trim()) continue;
    if (a.kind === 'text' && (a.x < 0 || a.y < 0 || a.x + a.width > pages[a.page].width + 0.1 || a.y + a.height > pages[a.page].height + 0.1)) {
      throw Error(`A text box on page ${a.page + 1} extends beyond the page. Widen the box, reduce its font size, or move it before saving.`);
    }
    const page = doc.getPage(a.page);
    const vp = pages[a.page].page.getViewport({ scale: 1 });
    const w = a.width, h = a.height;
    const corners = [[a.x, a.y], [a.x + w, a.y], [a.x, a.y + h], [a.x + w, a.y + h]].map(([x, y]) => vp.convertToPdfPoint(x, y));
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
    const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // Express the appearance's local bottom-left axes in the source PDF's space.
    const origin = vp.convertToPdfPoint(a.x, a.y + h);
    const right = vp.convertToPdfPoint(a.x + 1, a.y + h);
    const up = vp.convertToPdfPoint(a.x, a.y + h - 1);
    const matrix = [right[0] - origin[0], right[1] - origin[1], up[0] - origin[0], up[1] - origin[1], 0, 0];
    const [r, g, b] = [1, 3, 5].map(i => parseInt(a.color.slice(i, i + 2), 16) / 255);
    const operators: PDFOperator[] = [pushGraphicsState()];
    const resources = doc.context.obj({});
    if (a.kind === 'text') {
      const font = fonts.get(fontStyle(a))!;
      const chars = new Set(font.getCharacterSet());
      for (const c of a.text) {
        if (c !== '\n' && c !== '\r' && !chars.has(c.codePointAt(0)!)) throw Error(`The bundled font cannot export “${c}”. Please replace that character before saving.`);
      }
      resources.set(PDFName.of('Font'), doc.context.obj({ F0: font.ref }));
      const lines = textLayout(a).lines;
      for (const [i, line] of lines.entries()) {
        const width = font.widthOfTextAtSize(line, a.size);
        const x = a.align === 'center' ? (w - width) / 2 : a.align === 'right' ? w - width - 6 : 6;
        // Noto Sans ascent 1.069 em, descent .293 em; CSS line-height is 1.45 em.
        const baseline = h - 6 - a.size * (1.069 + (1.45 - 1.362) / 2) - i * a.size * 1.45;
        operators.push(...drawText(font.encodeText(line), { font: 'F0', size: a.size, x, y: baseline, color: rgb(r, g, b), rotate: degrees(0), xSkew: degrees(0), ySkew: degrees(0) }));
      }
    } else if (a.kind === 'highlight') {
      resources.set(PDFName.of('ExtGState'), doc.context.obj({ Highlight: { Type: 'ExtGState', ca: 0.38, BM: 'Multiply' } }));
      operators.push(setGraphicsState('Highlight'), setFillingRgbColor(r, g, b), rectangle(0, 0, w, h), fill());
    } else if (a.points?.length) {
      operators.push(setStrokingRgbColor(r, g, b), setLineWidth(a.size / 6), setLineCap(LineCapStyle.Round));
      const [first, ...rest] = a.points;
      operators.push(moveTo(first.x, h - first.y), ...rest.map(p => lineTo(p.x, h - p.y)), stroke());
    }
    operators.push(popGraphicsState());
    const appearance = PDFContentStream.of(doc.context.obj({ Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Matrix: matrix, Resources: resources }), operators);
    const apRef = doc.context.register(appearance);
    const dict = doc.context.obj({
      Type: 'Annot', Subtype: a.kind === 'text' ? 'FreeText' : a.kind === 'draw' ? 'Ink' : 'Square',
      Rect: rect, F: 4, Border: [0, 0, 0], C: [r, g, b],
      Contents: PDFHexString.fromText(a.text), T: PDFHexString.fromText('Paperline'),
      NM: PDFString.of(a.id), AP: { N: apRef }, DA: PDFString.of(`/F0 ${a.size} Tf ${r} ${g} ${b} rg`),
      PaperlineData: PDFHexString.fromText(JSON.stringify(a)),
    });
    if (a.kind === 'draw') dict.set(PDFName.of('InkList'), doc.context.obj([(a.points ?? []).flatMap(p => vp.convertToPdfPoint(a.x + p.x, a.y + p.y))]));
    if (!page.node.Annots()) page.node.set(PDFName.of('Annots'), doc.context.obj([]));
    page.node.lookup(PDFName.of('Annots'), PDFArray).push(doc.context.register(dict));
  }
  return doc.save();
}

export function download(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes.slice().buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
