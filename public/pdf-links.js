(() => {
  if (globalThis.__paperlineLinksLoaded) return;
  globalThis.__paperlineLinksLoaded = true;
  let enabled = false;
  const ready = chrome.storage.local.get({ autoOpenLinks: true }).then(settings => { enabled = settings.autoOpenLinks; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.autoOpenLinks) enabled = changes.autoOpenLinks.newValue !== false;
  });
  const isPdfLink = url => /\.pdf(?:$|[?#])/i.test(url.pathname + url.search);
  const isMoodleResource = url => /\/mod\/resource\/view\.php$/i.test(url.pathname);
  function filename(url, response) {
    const header = response.headers.get('content-disposition') || '';
    let name = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1] || header.match(/filename\s*=\s*"([^"]+)"/i)?.[1] || url.pathname.split('/').pop() || 'Document.pdf';
    try { name = decodeURIComponent(name); } catch {}
    return name.split(/[\\/]/).pop();
  }
  async function handoff(url, newTab) {
    // Same-origin fetch preserves SameSite/HttpOnly login cookies and Referer,
    // unlike fetching an authenticated Moodle resource from an extension page.
    let response = await fetch(url.href, { credentials: 'include' });
    if (response.ok && isMoodleResource(url) && response.headers.get('content-type')?.includes('text/html')) {
      // Moodle may return an intermediate resource page with a PDF embed,
      // rather than redirecting straight to pluginfile.php.
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const candidates = [...page.querySelectorAll('iframe[src], embed[src], object[data], a[href]')];
      const source = candidates.map(node => {
        try { return new URL(node.getAttribute('src') || node.getAttribute('data') || node.getAttribute('href'), response.url); } catch { return null; }
      }).find(candidate => candidate?.origin === location.origin && isPdfLink(candidate));
      if (!source) throw Error('This resource is not a PDF');
      response = await fetch(source.href, { credentials: 'include' });
    }
    if (!response.ok) throw Error('PDF request failed');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 128 * 1024 * 1024 || !new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw Error('Not a PDF response');
    const started = await chrome.runtime.sendMessage({ type: 'paperline:handoff-start', url: url.href, name: filename(new URL(response.url || url.href), response), newTab });
    if (!started?.ok) throw Error(started?.error || 'Cannot prepare PDF');
    for (let offset = 0; offset < bytes.length; offset += 128 * 1024) {
      const chunk = bytes.subarray(offset, offset + 128 * 1024);
      let binary = '';
      for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
      const result = await chrome.runtime.sendMessage({ type: 'paperline:handoff-chunk', id: started.id, data: btoa(binary) });
      if (!result?.ok) throw Error(result?.error || 'Cannot transfer PDF');
    }
    const result = await chrome.runtime.sendMessage({ type: 'paperline:handoff-finish', id: started.id });
    if (!result?.ok) throw Error(result?.error || 'Cannot open PDF');
    if (!newTab) location.assign(result.url);
  }
  document.addEventListener('click', event => {
    if (!enabled || event.defaultPrevented || event.button !== 0 || event.altKey) return;
    const anchor = event.composedPath().find(node => node instanceof HTMLAnchorElement);
    if (!anchor || anchor.hasAttribute('download')) return;
    let url;
    try { url = new URL(anchor.href); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || !(isPdfLink(url) || isMoodleResource(url))) return;
    if (anchor.target && !['_self', '_blank', '_top', '_parent'].includes(anchor.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const newTab = anchor.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey;
    void handoff(url, newTab).catch(() => {
      // Login redirects and non-PDF responses retain their normal browser flow.
      if (newTab) window.open(url.href, '_blank', 'noopener'); else location.assign(url.href);
    });
  }, true);
  // Chrome can sniff a PDF even when the server omits its Content-Type header.
  // This path catches those documents if declarative redirects missed them.
  void ready.then(() => {
    if (enabled && /^(application|text)\/pdf$/i.test(document.contentType)) {
      void chrome.runtime.sendMessage({ type: 'paperline:pdf-document', url: location.href }).then(result => {
        if (result?.url) location.replace(result.url);
      }).catch(() => {});
    }
  });
})();
