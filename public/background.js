importScripts('handoff-store.js');
const RULE_IDS = [1, 2, 3, 4, 5];
const DEFAULTS = { autoOpenLinks: true, autoOpenDownloads: true };

function editorUrl(source, extra = {}) {
  const editor = new URL(chrome.runtime.getURL('index.html'));
  if (source && /^(https?|file):\/\//i.test(source)) editor.searchParams.set('source', source);
  for (const [key, value] of Object.entries(extra)) editor.searchParams.set(key, value);
  return editor.href;
}

// DNR redirects only document navigations. The editor's fetches are deliberately
// excluded, so fetching the source never redirects back to the editor.
async function syncRules() {
  const { autoOpenLinks } = await chrome.storage.local.get(DEFAULTS);
  const redirect = { type: 'redirect', redirect: { regexSubstitution: chrome.runtime.getURL('index.html') + '?pdf-source:\\0' } };
  const navigation = { resourceTypes: ['main_frame', 'sub_frame'], requestMethods: ['get'] };
  const rules = autoOpenLinks ? [
    { id: 1, priority: 10, action: redirect, condition: { ...navigation, regexFilter: '^https?://.*$', responseHeaders: [{ header: 'content-type', values: ['application/pdf', 'application/pdf;*', 'text/pdf', 'text/pdf;*', 'application/x-pdf', 'application/x-pdf;*'] }] } },
    { id: 2, priority: 9, action: redirect, condition: { ...navigation, regexFilter: '^https?://[^?#]*\\.pdf([?#].*)?$', responseHeaders: [{ header: 'content-type', values: ['application/octet-stream', 'application/octet-stream;*'] }] } },
    { id: 3, priority: 8, action: redirect, condition: { ...navigation, regexFilter: '^https?://.*$', responseHeaders: [{ header: 'content-disposition', values: ['*.pdf', '*.pdf"*', "*.pdf'*", '*.pdf;*'] }], excludedResponseHeaders: [{ header: 'content-type', excludedValues: ['application/octet-stream', 'application/octet-stream;*'] }] } },
    { id: 4, priority: 10, action: redirect, condition: { regexFilter: '^file://[^?#]*\\.pdf([?#].*)?$', resourceTypes: ['main_frame', 'sub_frame'] } },
    { id: 5, priority: 20, action: redirect, condition: { ...navigation, regexFilter: '^https?://[^?#]*\\.pdf([?#].*)?$' } },
  ] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: RULE_IDS, addRules: rules });
  await chrome.storage.local.remove('autoOpenError');
}
let ruleUpdates = Promise.resolve();
function scheduleRuleUpdate() {
  ruleUpdates = ruleUpdates.catch(() => {}).then(syncRules);
  return ruleUpdates;
}
// Runs on each service-worker start as well as installation. Dynamic rules stay
// active while the worker sleeps, and storage keeps the user's opt-out on updates.
void scheduleRuleUpdate().catch(reportSetupError);
function reportSetupError(error) {
  console.error('PDF auto-open setup failed:', error);
  void chrome.storage.local.set({ autoOpenError: error.message });
}
chrome.permissions.onAdded.addListener(() => { void scheduleRuleUpdate().catch(reportSetupError); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoOpenLinks) void scheduleRuleUpdate().catch(console.error);
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  let operation;
  if (message?.type === 'paperline:sync-rules') operation = scheduleRuleUpdate().then(() => ({ ok: true }));
  else if (typeof message?.type === 'string' && message.type.startsWith('paperline:handoff-')) operation = handleHandoff(message, sender);
  else if (message?.type === 'paperline:pdf-document') operation = detectedPdf(message, sender);
  else return;
  operation.then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  const source = tab.url && (/\.pdf(?:$|[?#])/i.test(tab.url) ? tab.url : null);
  chrome.tabs.create({ url: editorUrl(source) });
});
chrome.runtime.onInstalled.addListener(() => {
  void scheduleRuleUpdate().catch(reportSetupError);
  // Unpacked extension updates do not inject new content scripts into pages
  // that were already open (including an existing Moodle tab).
  void chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).then(tabs => Promise.allSettled(tabs.map(tab => chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['pdf-links.js'] })))).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'paperline-link', title: 'Edit PDF in Paperline', contexts: ['link'], targetUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'] });
  });
});
chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'paperline-link') chrome.tabs.create({ url: editorUrl(info.linkUrl) });
});

const openingDownloads = new Set();
async function openDownloadedPdf(item) {
  if (item.state !== 'complete' || item.exists === false || !['safe', 'accepted', 'deepScannedSafe', 'allowlistedByPolicy'].includes(item.danger)) return;
  if (!item.filename || !(item.mime?.split(';')[0].trim().toLowerCase() === 'application/pdf' || /\.pdf$/i.test(item.filename))) return;
  const ownOrigin = chrome.runtime.getURL('');
  if (item.byExtensionId === chrome.runtime.id || item.url.startsWith(ownOrigin) || item.url.startsWith('blob:' + ownOrigin)) return;
  if (openingDownloads.has(item.id)) return;
  openingDownloads.add(item.id);
  try {
    const { autoOpenDownloads } = await chrome.storage.local.get(DEFAULTS);
    if (!autoOpenDownloads) return;
    const key = `opened-download:${item.id}`;
    if ((await chrome.storage.session.get(key))[key]) return;
    const source = new URL('file:///');
    source.pathname = item.filename.replaceAll('\\', '/');
    const canReadFiles = await chrome.extension.isAllowedFileSchemeAccess();
    const fallback = item.finalUrl || item.url;
    const openSource = !canReadFiles && /^https?:\/\//i.test(fallback) ? fallback : source.href;
    const tab = await chrome.tabs.create({ url: editorUrl(openSource, { download: String(item.id), local: source.href, name: item.filename.split(/[\\/]/).pop() }) });
    await chrome.storage.session.set({ [key]: tab.id });
  } finally { openingDownloads.delete(item.id); }
}
function checkDownload(id) {
  chrome.downloads.search({ id }).then(items => items[0] && openDownloadedPdf(items[0])).catch(error => console.warn('Could not open downloaded PDF:', error));
}
chrome.downloads.onCreated.addListener(item => {
  // Very small downloads can already be complete when onCreated is delivered.
  if (item.state === 'complete') void openDownloadedPdf(item).catch(console.warn);
});
chrome.downloads.onChanged.addListener(delta => {
  if (delta.state?.current === 'complete' || delta.filename || delta.mime || delta.danger) checkDownload(delta.id);
});


const requestMethods = new Map();
chrome.webRequest.onBeforeRequest.addListener(details => {
  requestMethods.set(`${details.tabId}:${details.frameId}`, { url: details.url, method: details.method });
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame'] });
chrome.tabs.onRemoved.addListener(tabId => {
  for (const key of requestMethods.keys()) if (key.startsWith(`${tabId}:`)) requestMethods.delete(key);
});
function isPdfAddress(address) {
  try { return /^(https?|file):$/.test(new URL(address).protocol) && /\.pdf$/i.test(new URL(address).pathname); } catch { return false; }
}
function wasPost(tabId, frameId, url) {
  const request = requestMethods.get(`${tabId}:${frameId}`);
  return request?.url === url && request.method !== 'GET';
}
// Independent of DNR: catches a PDF if another handler, unusual headers, stale
// rules, or withheld host access let Chrome's native viewer commit first.
chrome.webNavigation.onCommitted.addListener(details => {
  if (!isPdfAddress(details.url) || wasPost(details.tabId, details.frameId, details.url)) return;
  void (async () => {
    const { autoOpenLinks } = await chrome.storage.local.get(DEFAULTS);
    if (!autoOpenLinks) return;
    const frame = await chrome.webNavigation.getFrame({ tabId: details.tabId, frameId: details.frameId });
    if (frame?.url !== details.url) return;
    const url = editorUrl(details.url);
    if (details.frameId === 0) await chrome.tabs.update(details.tabId, { url });
    else await chrome.scripting.executeScript({ target: { tabId: details.tabId, frameIds: [details.frameId] }, func: target => location.replace(target), args: [url] });
  })().catch(error => console.warn('PDF navigation fallback:', error.message));
});
async function detectedPdf(message, sender) {
  if (!sender.tab || message.url !== sender.url || wasPost(sender.tab.id, sender.frameId, message.url)) return { ok: false };
  const { autoOpenLinks } = await chrome.storage.local.get(DEFAULTS);
  return autoOpenLinks ? { ok: true, url: editorUrl(message.url) } : { ok: false };
}

const transfers = new Map();
async function handleHandoff(message, sender) {
  if (!sender.tab || !sender.url) throw Error('This PDF must be opened from its original page.');
  if (message.type === 'paperline:handoff-start') {
    const source = new URL(message.url), page = new URL(sender.url);
    if (!['http:', 'https:'].includes(source.protocol) || source.origin !== page.origin) throw Error('PDF source must belong to this site.');
    const { autoOpenLinks } = await chrome.storage.local.get(DEFAULTS);
    if (!autoOpenLinks) throw Error('Automatic PDF opening is off.');
    for (const [id, transfer] of transfers) if (transfer.created < Date.now() - 120000) transfers.delete(id);
    if (transfers.size >= 8) throw Error('Too many PDFs are opening at once.');
    const id = crypto.randomUUID();
    transfers.set(id, { tabId: sender.tab.id, windowId: sender.tab.windowId, frameId: sender.frameId, source: source.href, name: String(message.name || 'Document.pdf').slice(0, 500), newTab: message.newTab === true, chunks: [], size: 0, created: Date.now() });
    return { ok: true, id };
  }
  const transfer = transfers.get(message.id);
  if (!transfer || transfer.tabId !== sender.tab.id || transfer.frameId !== sender.frameId) throw Error('PDF transfer expired. Open the link again.');
  if (message.type === 'paperline:handoff-chunk') {
    if (typeof message.data !== 'string' || message.data.length > 180000) throw Error('Invalid PDF chunk.');
    const data = Uint8Array.from(atob(message.data), c => c.charCodeAt(0));
    transfer.size += data.length;
    if (transfer.size > 128 * 1024 * 1024) { transfers.delete(message.id); throw Error('PDF is too large for this handoff.'); }
    transfer.chunks.push(data);
    return { ok: true };
  }
  if (message.type !== 'paperline:handoff-finish' || !transfer.size) throw Error('Incomplete PDF transfer.');
  transfers.delete(message.id);
  const blob = new Blob(transfer.chunks, { type: 'application/pdf' });
  if (!new TextDecoder().decode(await blob.slice(0, 1024).arrayBuffer()).includes('%PDF-')) throw Error('The response is not a PDF.');
  await paperlineStore.put({ id: message.id, name: transfer.name, blob, created: Date.now() });
  const url = editorUrl(transfer.source, { import: message.id });
  if (transfer.newTab) await chrome.tabs.create({ url, windowId: transfer.windowId, openerTabId: sender.tab.id });
  return { ok: true, url };
}
