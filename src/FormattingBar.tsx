import { AlignCenter, AlignLeft, AlignRight, Bold, Check, Copy, Italic, PenLine, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { COLORS, HIGHLIGHTS, clamp, type Annotation } from './model';

type Props = {
  kind: Annotation['kind']; properties: Partial<Annotation>; color: string; selected: boolean;
  update: (patch: Partial<Annotation>) => void; duplicate: () => void; remove: () => void;
  edit?: () => void; close: () => void;
};

export function FormattingBar({ kind, properties, color, selected, update, duplicate, remove, edit, close }: Props) {
  const [sizeInput, setSizeInput] = useState(String(properties.size ?? 14));
  useEffect(() => { setSizeInput(String(properties.size ?? 14)); }, [properties.size]);
  function applySize() {
    const size = sizeInput.trim() && Number.isFinite(Number(sizeInput)) ? clamp(Number(sizeInput), 6, 96) : properties.size ?? 14;
    update({ size }); setSizeInput(String(size));
  }
  return <div className="formatting-bar" role="toolbar" aria-label={`${kind === 'text' ? 'Text' : kind === 'draw' ? 'Drawing' : 'Highlight'} formatting`}>
    {kind === 'text' && <>
      <span className="font-name">Noto Sans</span>
      <label className="size-input"><input aria-label="Font size" type="number" min={6} max={96} value={sizeInput} onChange={e => setSizeInput(e.target.value)} onBlur={applySize} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><span>pt</span></label>
      <span className="toolbar-divider" />
      <button className="icon-button" aria-label="Bold" title="Bold" aria-pressed={properties.bold ?? false} onClick={() => update({ bold: !properties.bold })}><Bold size={16} /></button>
      <button className="icon-button" aria-label="Italic" title="Italic" aria-pressed={properties.italic ?? false} onClick={() => update({ italic: !properties.italic })}><Italic size={16} /></button>
      <span className="toolbar-divider" />
      <div className="alignment-controls">{[{ value: 'left' as const, icon: AlignLeft }, { value: 'center' as const, icon: AlignCenter }, { value: 'right' as const, icon: AlignRight }].map(({ value, icon: Icon }) => <button key={value} className="icon-button" aria-label={`Align ${value}`} title={`Align ${value}`} aria-pressed={(properties.align ?? 'left') === value} onClick={() => update({ align: value })}><Icon size={16} /></button>)}</div>
      <span className="toolbar-divider" />
    </>}
    {kind === 'draw' && <label className="stroke-input"><PenLine size={15} /><input aria-label="Stroke width" type="range" min={6} max={48} value={properties.size ?? 14} onChange={e => update({ size: Number(e.target.value) })} /></label>}
    <div className="color-swatches">{(kind === 'highlight' ? HIGHLIGHTS : COLORS).map(c => <button key={c} className={`color-swatch ${color === c ? 'chosen' : ''}`} aria-label={`Use colour ${c}`} title={c.toUpperCase()} aria-pressed={color === c} style={{ backgroundColor: c }} onClick={() => update({ color: c })}>{color === c && <Check size={12} color={kind === 'highlight' ? '#454020' : '#fff'} />}</button>)}</div>
    <label className="custom-color" title="Custom colour"><span style={{ background: color }} /><input type="color" aria-label="Custom colour" value={color} onChange={e => update({ color: e.target.value })} /></label>
    {selected && <><span className="toolbar-divider" />{edit && <button className="palette-edit" onClick={edit}>Edit text</button>}<button className="icon-button" aria-label="Duplicate" title="Duplicate" onClick={duplicate}><Copy size={15} /></button><button className="icon-button delete-button" aria-label="Delete selected annotation" title="Delete" onClick={remove}><Trash2 size={15} /></button></>}
    <span className="toolbar-divider" /><button className="icon-button palette-close" aria-label="Close formatting" title="Done (Esc)" onClick={close}><X size={15} /></button>
  </div>;
}
