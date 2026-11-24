import { useEffect, useRef, useState } from 'react';
import type { pdfjs } from './pdf';

export type SearchMatch = { page: number; start: number; end: number };

// Keep offsets in the original string, including Unicode case expansions.
export function findText(text: string, query: string): { start: number; end: number }[] {
  if (!query.trim()) return [];
  const escaped = query.trim().split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return Array.from(text.matchAll(new RegExp(escaped, 'giu')), match => ({ start: match.index, end: match.index + match[0].length }));
}

export function useDocumentSearch(pdf: pdfjs.PDFDocumentProxy | undefined, query: string) {
  const [state, setState] = useState<{ matches: SearchMatch[]; pending: boolean; error: boolean }>({ matches: [], pending: false, error: false });
  const index = useRef<{ pdf: pdfjs.PDFDocumentProxy; text: string[] } | undefined>(undefined);
  useEffect(() => {
    if (index.current?.pdf !== pdf) index.current = undefined;
    if (!pdf || !query.trim()) { setState({ matches: [], pending: false, error: false }); return; }
    let cancelled = false;
    setState({ matches: [], pending: true, error: false });
    const timeout = setTimeout(async () => {
      try {
        let text = index.current?.pdf === pdf ? index.current.text : undefined;
        if (!text) {
          text = [];
          for (let page = 1; page <= pdf.numPages; page++) {
            if (cancelled) return;
            const content = await (await pdf.getPage(page)).getTextContent();
            text.push(content.items.flatMap(item => 'str' in item && item.str ? [item.str] : []).join(' '));
          }
          if (!cancelled) index.current = { pdf, text };
        }
        const matches = text.flatMap((value, page) => findText(value, query).map(match => ({ page, ...match })));
        if (!cancelled) setState({ matches, pending: false, error: false });
      } catch { if (!cancelled) setState({ matches: [], pending: false, error: true }); }
    }, 180);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [pdf, query]);
  return state;
}
