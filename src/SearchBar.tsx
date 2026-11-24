import { ArrowDown, ArrowUp, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

type Props = {
  query: string; onQuery: (query: string) => void; count: number; active: number;
  pending: boolean; error: boolean; onStep: (direction: number) => void; onClose: () => void;
};

export function SearchBar({ query, onQuery, count, active, pending, error, onStep, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const status = !query.trim() ? '' : pending ? 'Searching…' : error ? 'Search unavailable' : count ? `${active + 1} of ${count}` : 'No matches';
  return <div className="search-bar glass" role="search" aria-label="Find in PDF" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
  }}>
    <Search size={17} aria-hidden="true" />
    <input ref={input} aria-label="Find in document" placeholder="Find in document…" value={query} onChange={e => onQuery(e.target.value)} />
    <span className="search-status" role="status" aria-live="polite">{status}</span>
    <button className="icon-button" aria-label="Previous match" title="Previous match (Shift + Enter)" disabled={!count || pending} onClick={() => onStep(-1)}><ArrowUp size={16} /></button>
    <button className="icon-button" aria-label="Next match" title="Next match (Enter)" disabled={!count || pending} onClick={() => onStep(1)}><ArrowDown size={16} /></button>
    <button className="icon-button" aria-label="Close search" onClick={onClose}><X size={16} /></button>
  </div>;
}
