import { useCallback, useEffect, useRef, useState } from 'react';
import { get, set, del } from 'idb-keyval';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCheck, FileText, FolderOpen,
  Highlighter, Keyboard, LayoutPanelLeft, LockKeyhole, Minus, MoreHorizontal,
  MousePointer2, PenLine, Plus, Redo2, Settings2, Type, Undo2, Upload, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Page, Thumbnail } from './Page';
import { useHistory } from './history';
import { COLORS, HIGHLIGHTS, clamp, type Annotation, type Draft, type Tool } from './model';
import { download, exportPdf, readPdf, textLayout, type PageInfo, type pdfjs } from './pdf';
import { initialSource, sourceFilename } from './source';
import { FormattingBar } from './FormattingBar';
import { readHandoff } from './handoff';

const DRAFT_KEY = 'paperline:last-draft:v1';
const tools: { id: Tool; label: string; key: string; icon: LucideIcon }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
  { id: 'highlight', label: 'Highlight', key: 'H', icon: Highlighter },
  { id: 'draw', label: 'Draw', key: 'D', icon: PenLine },
];

function IconButton({ icon: Icon, label, ...props }: { icon: LucideIcon; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className="icon-button" title={label} aria-label={label} {...props}><Icon size={18} strokeWidth={1.75} /></button>;
}

export default function App() {
  const history = useHistory();
  const { annotations, commit, reset } = history;
  const [document, setDocument] = useState<{ bytes: Uint8Array; name: string; pdf: pdfjs.PDFDocumentProxy; pages: PageInfo[] } | null>(null);
  const documentRef = useRef(document); documentRef.current = document;
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(0);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState(true);
  const [showPages, setShowPages] = useState(false);
  const [pageInput, setPageInput] = useState('1');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftStatus, setDraftStatus] = useState('Local draft ready');
  const [typing, setTyping] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [remoteSource, setRemoteSource] = useState<string | null>(initialSource);
  const [needsFileAccess, setNeedsFileAccess] = useState(false);
  const [needsSiteAccess, setNeedsSiteAccess] = useState(false);
  const [defaults, setDefaults] = useState<Partial<Annotation>>({ size: 14, color: COLORS[0], bold: false, italic: false, align: 'left' });
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHTS[0]);
  const stage = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadToken = useRef(0);
  const modal = useRef<HTMLElement>(null);
  const current = annotations.find(a => a.id === selected);
  const properties = current ?? defaults;
  const showFormatting = !!current || tool !== 'select';
  const saveStatus = typing ? 'Saving draft…' : draftStatus;
  const isHighlight = current?.kind === 'highlight' || (!current && tool === 'highlight');
  const color = current?.color ?? (isHighlight ? highlightColor : defaults.color);
  const modifier = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';

  useEffect(() => { setPageInput(String(activePage + 1)); }, [activePage]);
  useEffect(() => { get<Draft>(DRAFT_KEY).then(value => setDraft(value ?? null)).catch(() => {}); }, []);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(null), 4000); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    if (!shortcuts) return;
    const previous = window.document.activeElement as HTMLElement | null;
    modal.current?.querySelector('button')?.focus();
    return () => previous?.focus();
  }, [shortcuts]);
  useEffect(() => { if (selected && !annotations.some(a => a.id === selected)) { setSelected(null); setEditing(null); } }, [annotations, selected]);
  useEffect(() => {
    if (!document) return;
    setDraftStatus('Saving draft…');
    const timeout = setTimeout(() => {
      set(DRAFT_KEY, { bytes: document.bytes, name: document.name, annotations, updated: Date.now() } satisfies Draft)
        .then(() => setDraftStatus('Draft saved on this device'))
        .catch(() => setDraftStatus('Draft unavailable — save your PDF'));
    }, 550);
    return () => clearTimeout(timeout);
  }, [document, annotations]);
  useEffect(() => {
    if (!stage.current || !document || !fit) return;
    const update = () => setScale(clamp((stage.current!.clientWidth - (window.innerWidth < 700 ? 24 : 80)) / Math.max(...document.pages.map(p => p.width)), 0.15, 1.6));
    const observer = new ResizeObserver(update); observer.observe(stage.current); update();
    return () => observer.disconnect();
  }, [document, fit, showPages]);

  const openBytes = useCallback(async (bytes: Uint8Array, name: string, restored?: Annotation[]) => {
    const token = ++loadToken.current;
    setBusy('Opening your PDF'); setError(null); setToast(null);
    try {
      await Promise.all(['400', '700', 'italic 400', 'italic 700'].map(style => window.document.fonts.load(`${style} 14px "Noto Sans"`)));
      const result = await readPdf(bytes);
      if (loadToken.current !== token) { await result.pdf.loadingTask.destroy(); return; }
      const previous = documentRef.current;
      setDocument({ ...result, name });
      reset(restored ?? result.annotations);
      setSelected(null); setEditing(null); setTyping(false); setActivePage(0); setFit(true); setTool('select');
      setRemoteSource(null); setNeedsFileAccess(false); setNeedsSiteAccess(false); window.history.replaceState({}, '', location.pathname);
      if (previous) void previous.pdf.loadingTask.destroy();
      stage.current?.scrollTo({ top: 0 });
    } catch (cause) {
      if (token !== loadToken.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/password|encrypt/i.test(message) ? 'This PDF is password-protected. Open an unlocked copy to edit it.' : 'We couldn’t open that PDF. Try downloading it first, or choose another file.');
      console.warn('PDF open failed:', message);
    } finally { if (token === loadToken.current) setBusy(null); }
  }, [reset]);

  function openFile(file?: File) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setError('Choose a PDF file to get started.'); return; }
    void file.arrayBuffer().then(bytes => openBytes(new Uint8Array(bytes), file.name)).catch(() => setError('That file could not be read. Please choose it again.'));
  }
  async function openDemo() {
    try { const response = await fetch('sample.pdf'); if (!response.ok) throw Error(); await openBytes(new Uint8Array(await response.arrayBuffer()), 'The next chapter.pdf'); }
    catch { setError('The sample PDF could not be opened. Please choose a file.'); }
  }
  async function openRemote() {
    if (!remoteSource) return;
    try {
      const url = new URL(remoteSource);
      if (!['https:', 'http:', 'file:'].includes(url.protocol)) throw Error();
      if (url.protocol !== 'file:' && globalThis.chrome?.permissions && !(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))) {
        setNeedsSiteAccess(true); setError(null); setBusy(null); return;
      }
      if (url.protocol === 'file:' && !(await chrome.extension.isAllowedFileSchemeAccess())) {
        setNeedsFileAccess(true);
        setError(null); setBusy(null);
        return;
      }
      setNeedsFileAccess(false);
      setNeedsSiteAccess(false);
      setBusy('Fetching your PDF'); setError(null);
      const response = await fetch(url.href, { credentials: 'include' });
      if (!response.ok) throw Error();
      if (response.headers.get('content-type')?.includes('text/html')) throw Error('The site returned a sign-in page. Sign in to the site and click its PDF link again.');
      const bytes = new Uint8Array(await response.arrayBuffer());
      await openBytes(bytes, new URLSearchParams(location.search).get('name') || sourceFilename(url, response.headers.get('content-disposition')));
    } catch (cause) {
      setBusy(null);
      const localSource = new URLSearchParams(location.search).get('local');
      if (localSource?.startsWith('file:') && !(await chrome.extension.isAllowedFileSchemeAccess())) {
        setRemoteSource(localSource); setNeedsFileAccess(true); setError(null); return;
      }
      if (cause instanceof Error && cause.message.includes('sign-in page')) { setError(cause.message); return; }
      setError(remoteSource.startsWith('file:')
        ? 'This local PDF could not be read. It may have moved or been removed. Use Open PDF to choose it again.'
        : 'The site blocked this PDF, or Paperline needs site access. Check its permissions in Chrome, or download the PDF and choose Open PDF.');
    }
  }
  const initialRemote = useRef(false);
  useEffect(() => {
    if (initialRemote.current) return;
    const imported = new URLSearchParams(location.search).get('import');
    if (imported) {
      initialRemote.current = true; setBusy('Opening your PDF');
      void readHandoff(imported).then(({ bytes, name }) => openBytes(bytes, name)).catch(error => { setBusy(null); setError(error.message); });
    } else if (remoteSource) { initialRemote.current = true; void openRemote(); }
  }, [remoteSource, openBytes]);
  async function allowSite() {
    if (!remoteSource) return;
    try {
      const url = new URL(remoteSource);
      if (await chrome.permissions.request({ origins: [`${url.origin}/*`] })) { setNeedsSiteAccess(false); await openRemote(); }
    } catch { setError('Site access could not be enabled. Open Paperline’s extension details in Chrome and allow access to this site.'); }
  }

  function updateProperties(patch: Partial<Annotation>) {
    if (current) {
      commit(prev => prev.map(a => {
        if (a.id !== current.id) return a;
        const next = { ...a, ...patch };
        if (a.kind === 'text') next.height = textLayout(next).height;
        return next;
      }));
    } else if (isHighlight && patch.color) setHighlightColor(patch.color);
    else setDefaults(prev => ({ ...prev, ...patch }));
  }
  function chooseTool(value: Tool) {
    (window.document.activeElement as HTMLElement)?.blur();
    setTool(value); setSelected(null); setEditing(null);
  }
  function duplicate() {
    if (!current || !document) return;
    const info = document.pages[current.page];
    const a = { ...current, id: crypto.randomUUID(), x: Math.min(current.x + 16, info.width - current.width), y: Math.min(current.y + 16, info.height - current.height) };
    commit(prev => [...prev, a]); setSelected(a.id); setEditing(null);
  }
  function remove() { if (selected) { commit(prev => prev.filter(a => a.id !== selected)); setSelected(null); setEditing(null); } }
  function nudge(key: string, amount: number) {
    if (!current || !document) return;
    const info = document.pages[current.page];
    const dx = key === 'ArrowLeft' ? -amount : key === 'ArrowRight' ? amount : 0;
    const dy = key === 'ArrowUp' ? -amount : key === 'ArrowDown' ? amount : 0;
    commit(prev => prev.map(a => a.id === current.id ? { ...a, x: clamp(a.x + dx, 0, Math.max(0, info.width - a.width)), y: clamp(a.y + dy, 0, Math.max(0, info.height - a.height)) } : a));
  }
  async function save() {
    const doc = documentRef.current;
    if (!doc || busy) return;
    (window.document.activeElement as HTMLElement)?.blur();
    setEditing(null); setBusy('Preparing your PDF'); setError(null);
    // onBlur commits the active textarea synchronously into history.current.
    try {
      const result = await exportPdf(doc.bytes, history.current.current, doc.pages);
      download(result, doc.name.replace(/(?:-edited)?\.pdf$/i, '') + '-edited.pdf');
      setToast('Your edited PDF is ready.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The PDF could not be saved. Please try again.'); }
    finally { setBusy(null); }
  }
  function goToPage(index: number) { setActivePage(index); window.document.getElementById(`page-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function commitPageInput() {
    if (!document) return;
    const page = /^\d+$/.test(pageInput) ? clamp(Number(pageInput), 1, document.pages.length) : activePage + 1;
    setPageInput(String(page)); goToPage(page - 1);
  }
  function zoom(delta: number) { setFit(false); setScale(prev => clamp(Math.round((prev + delta) * 100) / 100, 0.15, 3)); }

  const keyboardActions = useRef({ save, duplicate, remove, chooseTool, history, nudge, selected, shortcuts });
  keyboardActions.current = { save, duplicate, remove, chooseTool, history, nudge, selected, shortcuts };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const input = (e.target as Element)?.closest('textarea, input, select, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      const actions = keyboardActions.current;
      if (actions.shortcuts) {
        if (e.key === 'Escape') setShortcuts(false);
        if (e.key === 'Tab') { e.preventDefault(); modal.current?.querySelector('button')?.focus(); }
        return;
      }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void actions.save(); return; }
      if (input) return;
      if (mod && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); e.shiftKey || e.key.toLowerCase() === 'y' ? actions.history.redo() : actions.history.undo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); actions.duplicate(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); actions.remove(); }
      if (actions.selected && e.key.startsWith('Arrow')) { e.preventDefault(); actions.nudge(e.key, e.shiftKey ? 10 : 1); }
      if (e.key === 'Escape') { setSelected(null); setEditing(null); setShortcuts(false); setTool('select'); }
      if (!mod && !e.altKey) {
        const tool = tools.find(t => t.key.toLowerCase() === e.key.toLowerCase());
        if (tool) actions.chooseTool(tool.id);
        if (e.key === '?') setShortcuts(true);
      }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <div className={`app ${document ? 'has-document' : 'welcome'}`} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); openFile(e.dataTransfer.files[0]); }}>
    <input ref={fileInput} data-testid="file-input" type="file" accept="application/pdf,.pdf" hidden onChange={e => { openFile(e.target.files?.[0]); e.target.value = ''; }} />
    <header className="app-header" aria-label="PDF viewer toolbar">
      <div className="header-document">
        <span className="brand" aria-label="Paperline"><span className="brand-mark"><FileText size={18} strokeWidth={1.7} /></span>{!document && <span>paperline<span className="brand-dot">.</span></span>}</span>
        {document && <><span className="toolbar-divider" /><IconButton icon={LayoutPanelLeft} label="Toggle page navigator" aria-pressed={showPages} onClick={() => setShowPages(!showPages)} /><div className="document-name" title={document.name}>{document.name}</div></>}
      </div>
      {document && <div className="viewer-navigation">
        <div className="page-navigation"><IconButton icon={ArrowLeft} label="Previous page" disabled={activePage === 0} onClick={() => goToPage(activePage - 1)} /><input aria-label="Page number" inputMode="numeric" value={pageInput} onChange={e => setPageInput(e.target.value)} onBlur={commitPageInput} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitPageInput(); e.currentTarget.blur(); } }} /><span className="page-total">/ {document.pages.length}</span><IconButton icon={ArrowRight} label="Next page" disabled={activePage === document.pages.length - 1} onClick={() => goToPage(activePage + 1)} /></div>
        <span className="toolbar-divider" />
        <div className="zoom-controls"><IconButton icon={Minus} label="Zoom out" disabled={scale <= 0.15} onClick={() => zoom(-0.1)} /><select aria-label="Zoom" value={fit ? 'fit' : String(Math.round(scale * 100))} onChange={e => { if (e.target.value === 'fit') setFit(true); else { setFit(false); setScale(Number(e.target.value) / 100); } }}><option value="fit">Fit width</option>{Array.from(new Set([50, 75, 100, 125, 150, 200, Math.round(scale * 100)])).sort((a, b) => a - b).map(value => <option key={value} value={value}>{value}%</option>)}</select><IconButton icon={Plus} label="Zoom in" disabled={scale >= 3} onClick={() => zoom(0.1)} /></div>
      </div>}
      <div className="header-actions">
        {document && <>
          <div className="tool-switcher" role="toolbar" aria-label="Editing tools">{tools.map(t => <button key={t.id} className={`tool-button ${tool === t.id ? 'active' : ''}`} aria-label={`${t.label} tool`} aria-pressed={tool === t.id} title={`${t.label} (${t.key})`} onClick={() => chooseTool(t.id)}><t.icon size={17} strokeWidth={1.8} /></button>)}</div>
          <span className="toolbar-divider" />
          <div className="history-controls"><IconButton icon={Undo2} label={`Undo (${modifier} Z)`} disabled={!history.canUndo} onClick={history.undo} /><IconButton icon={Redo2} label={`Redo (${modifier} Shift Z)`} disabled={!history.canRedo} onClick={history.redo} /></div>
          <div className={`draft-status ${saveStatus.startsWith('Draft unavailable') ? 'draft-error' : ''}`} role="status" aria-label={saveStatus} title={saveStatus}><CheckCheck size={15} /><span>{saveStatus.startsWith('Draft saved') ? 'Saved' : saveStatus.startsWith('Draft unavailable') ? 'Not saved' : 'Saving…'}</span></div>
        </>}
        <IconButton icon={FolderOpen} label="Open PDF" onClick={() => fileInput.current?.click()} disabled={!!busy} />
        <HeaderMenu onOpen={() => fileInput.current?.click()} onShortcuts={() => setShortcuts(true)} />
        {document && <button className="button primary save-button" aria-label="Save PDF" title={`Save PDF (${modifier} S)`} onClick={() => void save()} disabled={!!busy}><ArrowDownToLine size={16} /><span>Save</span></button>}
      </div>
    </header>

    {error && <div className="error-banner" role="alert"><span>{error}</span><IconButton icon={X} label="Dismiss error" onClick={() => setError(null)} /></div>}

    {!document ? <main className="welcome-main">
      <div className="welcome-content">
        <div className="welcome-file"><FileText size={33} strokeWidth={1.25} /></div>
        <h1>Open a PDF.</h1>
        <p className="welcome-description">Add text, make a mark, save a copy.</p>
        <button className="dropzone" onClick={() => fileInput.current?.click()} disabled={!!busy}>
          <Upload size={21} strokeWidth={1.5} /><strong>Choose a PDF</strong><span>or drop it anywhere in this window</span>
        </button>
        {remoteSource && (needsSiteAccess ? <div className="remote-card"><div><strong>Allow Paperline on this site</strong><p>Chrome has not granted access to {new URL(remoteSource).hostname}. Enable it to open this PDF automatically.</p></div><button className="button primary" onClick={() => void allowSite()}>Allow site & open</button></div> : needsFileAccess ? <div className="remote-card file-access-card"><div><strong>One Chrome setting to open this PDF</strong><p>Enable <b>Allow access to file URLs</b> in Paperline’s extension details, then return here. Or use Open PDF to choose the file.</p><div className="file-access-actions"><button className="button primary" onClick={() => void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })}>Open extension details</button><button className="button secondary" onClick={() => void openRemote()}>Try again</button></div></div></div> : <div className="remote-card"><div><strong>Open the PDF from your browser</strong><p>Retry the source, or choose a downloaded copy.</p></div><button className="button secondary" onClick={() => void openRemote()}>Try again</button></div>)}
        {draft && <div className="draft-card"><FileText size={19} /><div><small>RECENT DRAFT</small><strong>{draft.name}</strong></div><button className="button secondary" onClick={() => void openBytes(draft.bytes, draft.name, draft.annotations)}>Continue <ArrowRight size={13} /></button><IconButton icon={X} label="Delete local draft" onClick={() => { void del(DRAFT_KEY); setDraft(null); }} /></div>}
        <button className="sample-link" onClick={() => void openDemo()} disabled={!!busy}>Try a sample PDF <ArrowRight size={13} /></button>
        <p className="privacy-note"><LockKeyhole size={11} />Files stay on your device.</p>
      </div>
    </main> : <main className="workspace">
      {showPages && <aside className="pages-panel" aria-label="Page navigator"><div className="panel-title"><h2>Pages</h2><IconButton icon={X} label="Close page navigator" onClick={() => setShowPages(false)} /></div><div className="thumbnails">{document.pages.map((info, i) => <Thumbnail key={i} info={info} index={i} active={activePage === i} count={annotations.filter(a => a.page === i).length} onClick={() => goToPage(i)} />)}</div></aside>}
      <div className="document-stage" ref={stage} onPointerDown={e => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('pages-stack')) { (window.document.activeElement as HTMLElement)?.blur(); setSelected(null); setEditing(null); } }}>
        <div className="pages-stack">{document.pages.map((info, i) => <Page key={`${document.pdf.fingerprints[0]}-${i}`} info={info} index={i} scale={scale} tool={tool} annotations={annotations.filter(a => a.page === i)} selected={selected} editing={editing} defaults={tool === 'highlight' ? { ...defaults, color: highlightColor } : defaults} select={setSelected} edit={setEditing} commit={commit} onActive={setActivePage} onTyping={setTyping} />)}</div>
      </div>
      {showFormatting && <FormattingBar kind={current?.kind ?? (tool === 'highlight' ? 'highlight' : tool === 'draw' ? 'draw' : 'text')} properties={properties} color={color ?? COLORS[0]} selected={!!current} update={updateProperties} duplicate={duplicate} remove={remove} edit={current?.kind === 'text' ? () => setEditing(current.id) : undefined} close={() => { setSelected(null); setEditing(null); setTool('select'); }} />}
      {tool !== 'select' && !selected && <div className="tool-hint">{tool === 'text' ? 'Click on the page to add text' : tool === 'highlight' ? 'Drag to highlight an area' : 'Draw anywhere on the page'}<kbd>esc</kbd></div>}
    </main>}

    {busy && <div className="busy-overlay" role="status"><div className="busy-card"><span className="spinner" /><strong>{busy}</strong><span>Keeping everything on your device.</span></div></div>}
    {dragging && <div className="drop-overlay"><Upload size={42} /><h2>Drop to open</h2><p>Drop your PDF to open it in Paperline.</p></div>}
    {toast && <div className="toast" role="status"><span><Check size={16} /></span>{toast}</div>}
    {shortcuts && <div className="modal-overlay" onClick={() => setShortcuts(false)}><section ref={modal} className="shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={e => e.stopPropagation()}><div className="modal-heading"><span><Keyboard size={20} />Keyboard shortcuts</span><IconButton icon={X} label="Close shortcuts" onClick={() => setShortcuts(false)} /></div>{[['Select', 'V'], ['Add text', 'T'], ['Highlight', 'H'], ['Draw', 'D'], ['Save PDF', `${modifier} S`], ['Undo', `${modifier} Z`], ['Redo', `${modifier} Shift Z`], ['Duplicate selected edit', `${modifier} D`], ['Move selected edit 1 pt', 'Arrow keys'], ['Move selected edit 10 pt', 'Shift + arrows'], ['Delete selected edit', '⌫ / Delete'], ['Finish editing text', 'Esc']].map(([label, key]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{key}</kbd></div>)}<p>Double-click a text box to edit it. Use arrow keys in text as usual.</p></section></div>}
  </div>;
}

function HeaderMenu({ onOpen, onShortcuts }: { onOpen: () => void; onShortcuts: () => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function close(e: PointerEvent) { if (!menu.current?.contains(e.target as Node)) menu.current?.removeAttribute('open'); }
    function escape(e: KeyboardEvent) { if (e.key === 'Escape' && menu.current?.open) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } }
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, []);
  function run(action: () => void) { if (menu.current) { menu.current.open = false; menu.current.querySelector('summary')?.focus(); } action(); }
  return <details className="more-menu" ref={menu}><summary aria-label="More options" title="More options"><MoreHorizontal size={19} /></summary><div className="menu-content"><button onClick={() => run(onOpen)}><FolderOpen size={16} />Open PDF</button><button onClick={() => run(onShortcuts)}><Keyboard size={16} />Keyboard shortcuts<span>?</span></button>{globalThis.chrome?.runtime?.id && <button onClick={() => run(() => { void chrome.runtime.openOptionsPage(); })}><Settings2 size={16} />Paperline settings</button>}</div></details>;
}
