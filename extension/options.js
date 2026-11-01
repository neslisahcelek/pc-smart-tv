/**
 * Smart TV Dizi Takipçisi - Options Page Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const progressTokenInput = document.getElementById('progressToken');
  const delaySecondsInput = document.getElementById('delaySeconds');
  const autoSyncBookmarksInput = document.getElementById('autoSyncBookmarks');
  const newSiteInput = document.getElementById('newSiteInput');
  const btnAddSite = document.getElementById('btnAddSite');
  const siteTags = document.getElementById('siteTags');
  const btnTest = document.getElementById('btnTest');
  const settingsForm = document.getElementById('settingsForm');
  const toast = document.getElementById('toast');

  let currentCustomSites = [];

  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.style.background = isError ? '#dc2626' : '#059669';
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }

  function renderTags() {
    siteTags.innerHTML = '';
    currentCustomSites.forEach((site) => {
      const tag = document.createElement('div');
      tag.className = 'site-tag';

      const labelSpan = document.createElement('span');
      labelSpan.textContent = site;
      tag.appendChild(labelSpan);

      const delSpan = document.createElement('span');
      delSpan.className = 'site-tag-del';
      delSpan.textContent = '×';
      delSpan.setAttribute('data-site', site);
      delSpan.addEventListener('click', () => {
        currentCustomSites = currentCustomSites.filter((s) => s !== site);
        renderTags();
      });
      tag.appendChild(delSpan);

      siteTags.appendChild(tag);
    });
  }

  // Load existing settings
  const defaults = {
    serverUrl: 'http://localhost:3000',
    progressToken: '',
    delaySeconds: 60,
    autoSyncBookmarks: true,
    customSites: []
  };
  const stored = await chrome.storage.local.get(defaults);

  serverUrlInput.value = stored.serverUrl || defaults.serverUrl;
  progressTokenInput.value = stored.progressToken || '';
  delaySecondsInput.value = stored.delaySeconds || 60;
  autoSyncBookmarksInput.checked = stored.autoSyncBookmarks !== false;
  currentCustomSites = Array.isArray(stored.customSites) ? stored.customSites : [];
  renderTags();

  // Add site button
  btnAddSite.addEventListener('click', () => {
    const raw = newSiteInput.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (raw && !currentCustomSites.includes(raw)) {
      currentCustomSites.push(raw);
      newSiteInput.value = '';
      renderTags();
    }
  });

  // Test server connection
  btnTest.addEventListener('click', async () => {
    btnTest.disabled = true;
    btnTest.textContent = 'Bağlanılıyor...';

    const testUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
    const token = progressTokenInput.value.trim();

    try {
      const res = await fetch(`${testUrl}/api/progress`, {
        headers: token ? { 'X-Progress-Token': token } : {}
      });

      if (res.ok) {
        showToast('Bağlantı başarılı! Sunucu hazır.');
      } else if (res.status === 401) {
        showToast('Hata: PROGRESS_TOKEN hatalı veya eksik.', true);
      } else {
        showToast(`Sunucu HTTP ${res.status} hatası verdi.`, true);
      }
    } catch {
      showToast('Sunucuya ulaşılamadı. Sunucunun çalıştığından emin olun.', true);
    } finally {
      btnTest.disabled = false;
      btnTest.textContent = '🔗 Bağlantıyı Sına';
    }
  });

  // Save settings form
  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const newSettings = {
      serverUrl: serverUrlInput.value.trim().replace(/\/+$/, ''),
      progressToken: progressTokenInput.value.trim(),
      delaySeconds: Number(delaySecondsInput.value) || 60,
      autoSyncBookmarks: autoSyncBookmarksInput.checked,
      customSites: currentCustomSites
    };

    await chrome.storage.local.set(newSettings);
    showToast('Ayarlar başarıyla kaydedildi!');
  });
});
