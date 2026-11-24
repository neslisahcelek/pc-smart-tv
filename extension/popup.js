/**
 * Smart TV Dizi Takipçisi - Popup UI Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const serverDot = document.getElementById('serverDot');
  const serverLabel = document.getElementById('serverLabel');
  const cardLabel = document.getElementById('cardLabel');
  const seriesTitle = document.getElementById('seriesTitle');
  const episodeLabel = document.getElementById('episodeLabel');
  const statusPill = document.getElementById('statusPill');
  const btnSaveNow = document.getElementById('btnSaveNow');
  const btnAddSite = document.getElementById('btnAddSite');
  const linkOptions = document.getElementById('linkOptions');
  const toggleAutoSkipAds = document.getElementById('toggleAutoSkipAds');
  const adSkipMeta = document.getElementById('adSkipMeta');
  const toast = document.getElementById('toast');

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2500);
  }

  linkOptions.addEventListener('click', (e) => {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  // Query background for current status
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (!response || !response.ok) {
    seriesTitle.textContent = 'Sayfa bilgisi alınamadı';
    return;
  }

  const {
    isDizi,
    isAdSkipSite,
    tabAdsSkipped = 0,
    adsSkippedTotal = 0,
    isPending,
    watchState,
    url,
    title,
    hostname,
    settings
  } = response;

  function updateAdSkipMeta(enabled) {
    if (!enabled) {
      adSkipMeta.textContent = 'Kapalı';
      return;
    }
    if (tabAdsSkipped > 0) {
      adSkipMeta.textContent = `Bu sekmede ${tabAdsSkipped} geçildi • Toplam ${adsSkippedTotal}`;
    } else if (isAdSkipSite) {
      adSkipMeta.textContent =
        adsSkippedTotal > 0
          ? `Bu sitede aktif • Toplam ${adsSkippedTotal} geçildi`
          : 'Bu sitede aktif (5 sn önü reklamlar)';
    } else {
      adSkipMeta.textContent =
        adsSkippedTotal > 0
          ? `Dizi sitelerinde aktif • Toplam ${adsSkippedTotal}`
          : 'Yalnızca dizi sitelerinde aktif';
    }
  }

  const initialSkipEnabled = settings.autoSkipAds !== false;
  toggleAutoSkipAds.checked = initialSkipEnabled;
  updateAdSkipMeta(initialSkipEnabled);

  toggleAutoSkipAds.addEventListener('change', async () => {
    const enabled = toggleAutoSkipAds.checked;
    const res = await chrome.runtime.sendMessage({ type: 'SET_AD_SKIP_ENABLED', enabled });
    if (res && res.ok) {
      updateAdSkipMeta(enabled);
      showToast(enabled ? 'Otomatik reklam geçme açıldı' : 'Otomatik reklam geçme kapatıldı');
    }
  });

  // Test server connectivity
  try {
    const serverUrl = settings.serverUrl.replace(/\/+$/, '');
    const pingRes = await fetch(`${serverUrl}/api/progress`, {
      headers: settings.progressToken ? { 'X-Progress-Token': settings.progressToken } : {}
    });
    if (pingRes.ok) {
      serverDot.classList.add('online');
      serverLabel.textContent = 'Sunucu Hazır';
    } else {
      serverLabel.textContent = `Hata (${pingRes.status})`;
    }
  } catch {
    serverLabel.textContent = 'Sunucu Kapalı';
  }

  if (isDizi) {
    cardLabel.textContent = '🎬 Dizi Bölümü Algılandı';
    if (response.parsed) {
      seriesTitle.textContent = response.parsed.seriesTitle || title || hostname || 'Dizi Sayfası';
      episodeLabel.textContent = response.parsed.episodeLabel || (url ? new URL(url).pathname : '');
    } else {
      seriesTitle.textContent = title || hostname || 'Dizi Sayfası';
      episodeLabel.textContent = url ? new URL(url).pathname : '';
    }

    statusPill.style.display = 'inline-block';
    if (watchState?.savedCompleted) {
      statusPill.textContent = '⏭ Bölüm bitti, sonraki bölüm kaydedildi';
    } else if (watchState?.savedCurrent) {
      statusPill.textContent = '✓ Kaydedildi';
    } else if (isPending && watchState) {
      const label = watchState.isExistingSeries ? 'Takip edilen' : 'Yeni dizi';
      if (watchState.hasVideo && !watchState.isPlaying) {
        statusPill.textContent = `⏸ ${label}: Video oynatılması bekleniyor (${watchState.watchedSeconds}/${watchState.requiredSeconds} sn)`;
      } else {
        statusPill.textContent = `⏱ ${label}: ${watchState.watchedSeconds}/${watchState.requiredSeconds} sn izlendi`;
      }
    } else {
      statusPill.textContent = '✓ Takip ediliyor';
    }

    btnSaveNow.style.display = 'block';
    btnSaveNow.addEventListener('click', async () => {
      btnSaveNow.disabled = true;
      btnSaveNow.textContent = 'Kaydediliyor...';
      const saveRes = await chrome.runtime.sendMessage({ type: 'SAVE_NOW' });
      if (saveRes && saveRes.ok) {
        statusPill.textContent = '✓ Kaydedildi';
        showToast('Kaldığın yer sunucuya ve yer imlerine kaydedildi!');
      } else {
        showToast('Kayıt başarısız oldu.');
      }
      btnSaveNow.disabled = false;
      btnSaveNow.textContent = '🔖 Şimdi Sunucuya Kaydet';
    });
  } else {
    cardLabel.textContent = 'Aktif Sayfa';
    seriesTitle.textContent = hostname || 'Bilinmeyen Sayfa';
    episodeLabel.textContent = 'Bu site dizi listesinde değil.';

    if (hostname && !hostname.startsWith('chrome') && !hostname.startsWith('localhost')) {
      btnAddSite.style.display = 'block';
      btnAddSite.textContent = `➕ "${hostname}" Sitesini Ekle`;
      btnAddSite.addEventListener('click', async () => {
        // Request optional host permission directly in user click gesture if needed
        try {
          await chrome.permissions.request({
            origins: [`*://*.${hostname}/*`]
          });
        } catch {
          // ignore
        }

        const addRes = await chrome.runtime.sendMessage({
          type: 'ADD_CUSTOM_SITE',
          domain: hostname
        });

        if (addRes && addRes.ok) {
          showToast(`"${hostname}" izin verilen sitelere eklendi!`);
          btnAddSite.style.display = 'none';
          setTimeout(() => window.location.reload(), 800);
        }
      });
    }
  }
});
