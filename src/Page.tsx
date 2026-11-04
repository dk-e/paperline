import { useEffect, useRef, useState } from 'react';
import { GripHorizontal } from 'lucide-react';
import type { Annotation, Point, Tool } from './model';
import { clamp, makeAnnotation } from './model';
import { pdfjs, textLayout, type PageInfo } from './pdf';

type Props = {
  info: PageInfo; index: number; scale: number; tool: Tool;
  annotations: Annotation[]; selected: string | null; editing: string | null;
  defaults: Partial<Annotation>;
  select: (id: string | null) => void;
  edit: (id: string | null) => void;
  commit: (change: (prev: Annotation[]) => Annotation[]) => void;
  onActive: (index: number) => void;
  onTyping: (pending: boolean) => void;
};

export function Page({ info, index, scale, tool, annotations, selected, editing, defaults, select, edit, commit, onActive, onTyping }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [preview, setPreview] = useState<Annotation | null>(null);
  const gesture = useRef<{ start: Point; points: Point[] } | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '600px' });
    observer.observe(root.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) onActive(index); }, { rootMargin: '-25% 0px -60% 0px' });
    observer.observe(root.current!); return () => observer.disconnect();
  }, [index, onActive]);
  useEffect(() => {
    if (!visible || !canvas.current) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = info.page.getViewport({ scale: scale * dpr });
    const el = canvas.current;
    el.width = viewport.width; el.height = viewport.height;
    const render = info.page.render({ canvas: el, viewport });
    render.promise.catch(error => { if (error.name !== 'RenderingCancelledException') console.error(error); });
    return () => { render.cancel(); };
  }, [info, visible, scale]);
  useEffect(() => {
    if (!visible || !textLayer.current) return;
    const container = textLayer.current;
    container.replaceChildren();
    container.style.setProperty('--total-scale-factor', String(scale * info.page.userUnit));
    const layer = new pdfjs.TextLayer({
      textContentSource: info.page.streamTextContent(),
      container,
      viewport: info.page.getViewport({ scale }),
    });
    layer.render().catch(error => { if (error.name !== 'AbortException') console.error(error); });
    return () => { layer.cancel(); container.replaceChildren(); };
  }, [info, visible, scale]);

  function point(e: React.PointerEvent): Point {
    const rect = root.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - rect.left) / scale, 0, info.width), y: clamp((e.clientY - rect.top) / scale, 0, info.height) };
  }
  function pointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as Element).closest('.annotation')) return;
    onActive(index); edit(null); select(null);
    // Existing document text always uses native browser selection, regardless
    // of the active editing tool. Blank page space still accepts edits.
    if ((e.target as Element).closest('.pdf-text-layer span')) return;
    const p = point(e);
    if (tool === 'text') {
      e.preventDefault();
      const width = Math.min(220, info.width - 12);
      const a = makeAnnotation(index, 'text', clamp(p.x - 6, 0, info.width - width), clamp(p.y - 10, 0, info.height - 80), { ...defaults, width });
      commit(prev => [...prev, a]); select(a.id); edit(a.id); return;
    }
    if (tool === 'select') return;
    e.preventDefault();
    root.current!.setPointerCapture(e.pointerId);
    gesture.current = { start: p, points: [p] };
  }
  function pointerMove(e: React.PointerEvent) {
    if (!gesture.current) return;
    const p = point(e), { start, points } = gesture.current;
    if (tool === 'highlight') {
      setPreview(makeAnnotation(index, 'highlight', Math.min(start.x, p.x), Math.min(start.y, p.y), { ...defaults, color: defaults.color ?? '#ffe16a', width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) }));
    } else {
      if (Math.hypot(p.x - points.at(-1)!.x, p.y - points.at(-1)!.y) < 0.8 || points.length > 10000) return;
      points.push(p);
      const x = Math.max(0, Math.min(...points.map(p => p.x)) - 3), y = Math.max(0, Math.min(...points.map(p => p.y)) - 3);
      setPreview(makeAnnotation(index, 'draw', x, y, { ...defaults, width: Math.max(...points.map(p => p.x)) - x + 3, height: Math.max(...points.map(p => p.y)) - y + 3, points: points.map(p => ({ x: p.x - x, y: p.y - y })) }));
    }
  }
  function pointerUp() {
    if (!gesture.current) return;
    if (preview && preview.width > 2 && preview.height > 2) { commit(prev => [...prev, preview]); select(preview.id); }
    gesture.current = null; setPreview(null);
  }

  return <section className="page-section" aria-label={`Page ${index + 1}`} id={`page-${index}`}>
    <div ref={root} className={`pdf-page tool-${tool}`} style={{ width: info.width * scale, height: info.height * scale }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { gesture.current = null; setPreview(null); }}>
      <canvas ref={canvas} className="pdf-canvas" aria-label={`PDF page ${index + 1}`} />
      <div ref={textLayer} className="pdf-text-layer" />
      <div className="annotation-layer" style={{ width: info.width, height: info.height, transform: `scale(${scale})` }}>
        {annotations.map(a => <AnnotationBox key={a.id} a={a} selected={selected === a.id} editing={editing === a.id} pageWidth={info.width} pageHeight={info.height} scale={scale} select={select} edit={edit} commit={commit} onTyping={onTyping} />)}
        {preview && <div style={{ position: 'absolute', left: preview.x, top: preview.y, width: preview.width, height: preview.height }}><AnnotationShape a={preview} /></div>}
      </div>
    </div>
  </section>;
}

function AnnotationShape({ a }: { a: Annotation }) {
  if (a.kind === 'highlight') return <div className="highlight-shape" style={{ width: '100%', height: '100%', backgroundColor: a.color }} />;
  if (a.kind === 'draw') return <svg width="100%" height="100%" viewBox={`0 0 ${a.width} ${a.height}`} style={{ overflow: 'visible' }}><polyline points={a.points?.map(p => `${p.x},${p.y}`).join(' ')} stroke={a.color} strokeWidth={a.size / 6} fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return null;
}

function AnnotationBox({ a, selected, editing, scale, pageWidth, pageHeight, select, edit, commit, onTyping }: {
  a: Annotation; selected: boolean; editing: boolean; scale: number; pageWidth: number; pageHeight: number;
  select: Props['select']; edit: Props['edit']; commit: Props['commit']; onTyping: Props['onTyping'];
}) {
  const [local, setLocal] = useState<Annotation | null>(null);
  const [text, setText] = useState(a.text);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<{ type: 'move' | 'resize'; x: number; y: number; start: Annotation } | null>(null);
  const localRef = useRef<Annotation | null>(null);
  useEffect(() => { setText(a.text); }, [a.text]);
  useEffect(() => {
    if (!editing) return;
    onTyping(text !== a.text);
    return () => onTyping(false);
  }, [editing, text, a.text, onTyping]);
  useEffect(() => {
    if (!editing || a.text === text) return;
    const timeout = setTimeout(() => {
      const next = { ...a, text };
      next.height = textLayout(next).height;
      commit(prev => prev.map(item => item.id === a.id ? next : item));
    }, 600);
    return () => clearTimeout(timeout);
  }, [editing, a, text, commit]);
  useEffect(() => { if (editing) { textarea.current?.focus(); textarea.current?.setSelectionRange(text.length, text.length); } }, [editing]);
  const current = local ?? a;
  const layout = a.kind === 'text' ? textLayout({ ...current, text: editing ? text : current.text }) : null;
  const height = layout?.height ?? current.height;

  function start(e: React.PointerEvent, type: 'move' | 'resize') {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    if (editing) textarea.current?.blur();
    select(a.id); edit(null);
    drag.current = { type, x: e.clientX, y: e.clientY, start: { ...a, text: editing ? text : a.text, height } };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drag.current) return;
    const { type, x, y, start } = drag.current;
    const dx = (e.clientX - x) / scale, dy = (e.clientY - y) / scale;
    const next = type === 'move'
      ? { ...start, x: clamp(start.x + dx, 0, pageWidth - start.width), y: clamp(start.y + dy, 0, pageHeight - start.height) }
      : { ...start, width: clamp(start.width + dx, 40, pageWidth - start.x), height: a.kind === 'text' ? start.height : clamp(start.height + dy, 8, pageHeight - start.y) };
    localRef.current = next; setLocal(next);
  }
  function end() {
    if (!drag.current) return;
    if (localRef.current) {
      const next = localRef.current;
      if (next.kind === 'text') next.height = textLayout(next).height;
      commit(prev => prev.map(item => item.id === a.id ? next : item));
    }
    drag.current = null; localRef.current = null; setLocal(null);
  }
  function saveText() {
    const next = { ...a, text };
    next.height = textLayout(next).height;
    commit(prev => prev.map(item => item.id === a.id ? next : item));
    edit(null);
  }
  return <div
    className={`annotation ${selected ? 'selected' : ''} ${editing ? 'editing' : ''} annotation-${a.kind}`}
    data-annotation-id={a.id}
    style={{ left: current.x, top: current.y, width: current.width, height, color: a.color, fontSize: a.size, fontWeight: a.bold ? 700 : 400, fontStyle: a.italic ? 'italic' : 'normal', textAlign: a.align }}
    onPointerDown={e => { e.stopPropagation(); if (editing) return; start(e, 'move'); }}
    onPointerMove={move} onPointerUp={end} onPointerCancel={end}
    onDoubleClick={e => { e.stopPropagation(); if (a.kind === 'text') { select(a.id); edit(a.id); } }}
    tabIndex={0} aria-label={`${a.kind === 'text' ? 'Text box' : a.kind === 'draw' ? 'Drawing' : 'Highlight'}${a.text ? `: ${a.text.slice(0, 50)}` : ''}`}
    onFocus={() => select(a.id)}
    onKeyDown={e => { if (e.key === 'Enter' && !editing && a.kind === 'text') { e.preventDefault(); edit(a.id); } }}
  >
    {a.kind === 'text' ? editing
      ? <textarea ref={textarea} aria-label="Edit text box" value={text} spellCheck={false} onChange={e => setText(e.target.value.replace(/\t/g, '    '))} onBlur={saveText} onKeyDown={e => { if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) { e.preventDefault(); e.currentTarget.blur(); } }} style={{ height }} />
      : <div className="text-content">{(layout?.lines ?? ['']).map((line, i) => <div key={i} style={{ minHeight: a.size * 1.45 }}>{line || '\u200b'}</div>)}{!a.text && <span className="text-placeholder">Type something…</span>}</div>
      : <AnnotationShape a={current} />}
    {selected && <>
      <button className="drag-handle" aria-label="Move annotation" onPointerDown={e => start(e, 'move')}><GripHorizontal size={15} /><span>{a.kind === 'text' ? 'TEXT' : a.kind === 'draw' ? 'DRAWING' : 'HIGHLIGHT'}</span></button>
      {a.kind !== 'draw' && <button className="resize-handle" aria-label="Resize annotation" onPointerDown={e => start(e, 'resize')} />}
    </>}
  </div>;
}

export function Thumbnail({ info, index, active, count, onClick }: { info: PageInfo; index: number; active: boolean; count: number; onClick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let render: ReturnType<PageInfo['page']['render']> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || !canvas.current) return;
      observer.disconnect();
      const viewport = info.page.getViewport({ scale: 220 / info.width });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      render = info.page.render({ canvas: canvas.current, viewport });
      render.promise.catch(error => { if (error.name !== 'RenderingCancelledException') console.error(error); });
    });
    observer.observe(button.current!);
    return () => { observer.disconnect(); render?.cancel(); };
  }, [info]);
  return <button ref={button} className={`thumbnail ${active ? 'active' : ''}`} onClick={onClick} aria-label={`Go to page ${index + 1}`} aria-current={active ? 'page' : undefined}>
    <div className="thumbnail-paper" style={{ aspectRatio: `${info.width}/${info.height}` }}><canvas ref={canvas} />{count > 0 && <span className="annotation-count">{count}</span>}</div>
    <span className="thumbnail-label">{String(index + 1).padStart(2, '0')}<span>{active ? 'Viewing' : ''}</span></span>
  </button>;
}
