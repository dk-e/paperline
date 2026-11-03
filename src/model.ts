export type Tool = 'select' | 'text' | 'highlight' | 'draw';
export type FontStyle = 'regular' | 'bold' | 'italic' | 'boldItalic';
export type Point = { x: number; y: number };
export type Annotation = {
  id: string;
  page: number;
  kind: 'text' | 'highlight' | 'draw';
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  points?: Point[];
};
export type Draft = { bytes: Uint8Array; name: string; annotations: Annotation[]; updated: number };
export const COLORS = ['#202737', '#3563e9', '#dc425e', '#15845f', '#9155cd', '#c18513'];
export const HIGHLIGHTS = ['#ffe16a', '#a9e8cd', '#b9d6ff', '#f8b8d4'];
export const fontStyle = (a: Pick<Annotation, 'bold' | 'italic'>): FontStyle => a.bold ? (a.italic ? 'boldItalic' : 'bold') : a.italic ? 'italic' : 'regular';
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export function makeAnnotation(page: number, kind: Annotation['kind'], x: number, y: number, defaults: Partial<Annotation> = {}): Annotation {
  return { id: crypto.randomUUID(), page, kind, x, y, width: 220, height: 40, text: '', size: 14, color: COLORS[0], bold: false, italic: false, align: 'left', ...defaults };
}
