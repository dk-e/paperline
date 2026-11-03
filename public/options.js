const defaults = { autoOpenLinks: true, autoOpenDownloads: true };
const status = document.getElementById('save-status');
async function refreshFileAccess() {
  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  document.getElementById('file-status').textContent = allowed ? 'Local file access is enabled' : 'One Chrome setting for downloaded PDFs';
  document.getElementById('file-status-dot').classList.toggle('allowed', allowed);
}
async function checkSetup() {
  const version = chrome.runtime.getManifest().version;
  const allowed = await chrome.permissions.contains({ origins: ['http://*/*', 'https://*/*'] });
  const { autoOpenLinks = true, autoOpenError } = await chrome.storage.local.get(['autoOpenLinks', 'autoOpenError']);
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  const ready = allowed && autoOpenLinks && rules.length >= 5 && !autoOpenError;
  document.getElementById('setup-dot').classList.toggle('allowed', ready);
  document.getElementById('setup-state').textContent = ready ? 'Automatic opening is ready' : !allowed ? 'Chrome is withholding site access' : !autoOpenLinks ? 'Automatic PDF links are off' : 'Automatic opening needs repair';
  document.getElementById('setup-detail').textContent = `Paperline ${version}. ` + (ready ? 'Direct PDF links, authenticated site links and downloads are supported.' : autoOpenError || 'Use the button below to enable access and restore PDF handling.');
}
async function initialize() {
  const settings = await chrome.storage.local.get(defaults);
  for (const id of Object.keys(defaults)) {
    const input = document.getElementById(id);
    input.checked = settings[id];
    input.addEventListener('change', async () => {
      input.disabled = true;
      try {
        await chrome.storage.local.set({ [id]: input.checked });
        const result = await chrome.runtime.sendMessage({ type: 'paperline:sync-rules' });
        if (!result?.ok) throw Error(result?.error || 'Could not update PDF handling.');
        status.className = ''; status.textContent = 'Saved. Your choice applies to the next PDF.'; await checkSetup();
      } catch (error) { status.className = 'error'; status.textContent = error.message; }
      finally { input.disabled = false; }
    });
  }
  await refreshFileAccess(); await checkSetup();
}
document.getElementById('extension-details').addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
window.addEventListener('focus', () => { void refreshFileAccess(); });
void initialize().catch(error => { status.className = 'error'; status.textContent = error.message; });

document.getElementById('repair-auto-open').addEventListener('click', async () => {
  try {
    const allowed = await chrome.permissions.request({ origins: ['http://*/*', 'https://*/*'] });
    if (!allowed) throw Error('Chrome did not grant site access. You can also enable it on the extension details page.');
    await chrome.storage.local.set({ autoOpenLinks: true, autoOpenDownloads: true });
    const response = await chrome.runtime.sendMessage({ type: 'paperline:sync-rules' });
    if (!response?.ok) throw Error(response?.error || 'Could not restore automatic opening.');
    for (const id of Object.keys(defaults)) document.getElementById(id).checked = true;
    await checkSetup(); status.className = ''; status.textContent = 'Ready. Refresh the Moodle page, then click your PDF link again.';
  } catch (error) { status.className = 'error'; status.textContent = error.message; }
});
