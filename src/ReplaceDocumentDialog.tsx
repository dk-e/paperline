import { FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function ReplaceDocumentDialog({ name, save, resolve }: { name: string; save: () => Promise<boolean>; resolve: (replace: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="replace-dialog glass" aria-labelledby="replace-title" onCancel={e => { e.preventDefault(); if (!saving) resolve(false); }}>
    <FileText size={25} aria-hidden="true" />
    <h2 id="replace-title">Save a copy before switching?</h2>
    <p>Your edits to <strong>{name}</strong> are in the local recovery draft. Opening another PDF replaces that draft.</p>
    {failed && <p role="alert">The PDF could not be exported. Keep editing to review the error, or open without saving.</p>}
    <div className="replace-actions">
      <button className="button secondary" disabled={saving} autoFocus onClick={() => resolve(false)}>Keep editing</button>
      <button className="button secondary" disabled={saving} onClick={() => resolve(true)}>Open without saving</button>
      <button className="button primary" disabled={saving} onClick={async () => {
        setSaving(true);
        if (await save()) resolve(true); else { setSaving(false); setFailed(true); }
      }}>{saving ? 'Saving…' : 'Save copy & open'}</button>
    </div>
  </dialog>;
}
