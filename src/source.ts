// A declarative redirect cannot URL-encode its matched URL. Read its entire
// suffix verbatim, including query parameters, rather than splitting on '&'.
export function initialSource(): string | null {
  if (location.search.startsWith('?pdf-source:')) return location.search.slice('?pdf-source:'.length) + location.hash;
  return new URLSearchParams(location.search).get('source');
}

export function sourceFilename(url: URL, disposition?: string | null): string {
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = disposition?.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  let name = encoded || plain?.[1] || plain?.[2]?.trim() || url.pathname.split('/').pop() || 'Document.pdf';
  try { name = decodeURIComponent(name); } catch { /* Keep malformed filename escapes as text. */ }
  name = name.split(/[\\/]/).pop() || 'Document.pdf';
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}
