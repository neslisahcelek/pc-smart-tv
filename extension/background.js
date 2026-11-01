/**
 * Smart TV Dizi Takipçisi - Background Service Worker (Manifest V3)
 * Handles automatic episode detection, 60-second alarms, tv-controller API requests,
 * and 1-series-per-bookmark sync in Chrome's "dizi" bookmark folder.
 */

const KNOWN_SITE_KEYWORDS = [
  'dizipal',
  'dizibox',
  'dizigom',
  'dizilla',
  'hdfilmcehennemi',
  'filmmakinesi',
  'selcukflix',
  'yabancidizi',
  'tv.apple.com',
  'max.com',
  'hbomax'
];

/**
 * Normalizes title & URL to a common series key (matching server extractSeriesKey logic)
 */
function extractSeriesKey(title = '', rawUrl = '') {
  if (rawUrl) {
    try {
      const u = new URL(rawUrl);
      const mShow = u.pathname.match(/\/show\/([^/]+)/i);
      if (mShow && mShow[1]) {
        return mShow[1]
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
      }
      const mUrl = u.pathname.match(/\/dizi\/([^/]+)/i);
      if (mUrl && mUrl[1]) {
        return mUrl[1]
          .toLowerCase()
          .replace(/-izle.*$/, '')
          .replace(/[^a-z0-9]/g, '');
      }
      const mBolum = u.pathname.match(
        /\/bolum\/([a-z0-9-]+?)(?:-\d+-sezon|-\d+x\d+|-sezon-\d+|-bolum-\d+)/i
      );
      if (mBolum && mBolum[1]) {
        return mBolum[1]
          .toLowerCase()
          .replace(/-izle.*$/, '')
          .replace(/[^a-z0-9]/g, '');
      }
      const segments = u.pathname.split('/').filter(Boolean);
      for (const seg of segments) {
        const mSlug = seg.match(/^([a-z0-9-]+?)(?:-\d+-sezon|-\d+x\d+|-sezon-\d+)/i);
        if (mSlug && mSlug[1] && mSlug[1].toLowerCase() !== 'dizi' && mSlug[1].toLowerCase() !== 'bolum') {
          return mSlug[1]
            .toLowerCase()
            .replace(/-izle.*$/, '')
            .replace(/[^a-z0-9]/g, '');
        }
      }
    } catch {
      // ignore
    }
  }

  let clean = title
    .replace(
      /\b(apple\s*tv\+?|hbo\s*max|dizipal\d*|dizibox|dizigom\d*|dizilla|hdfilmcehennemi|filmmakinesi|selcukflix|yabancidizi(\.io)?)\b/gi,
      ''
    )
    .replace(/\s*\|\s*max\b/gi, '')
    .replace(/\s*-\s*max\b/gi, '')
    .replace(/^(?:watch|izle)\s+/i, '')
    .trim();
  clean = clean.replace(/^[|\-–—•\s]+|[|\-–—•\s]+$/g, '');

  // Check for "[Episode] - [Series] (Season X...)" pattern (e.g. Apple TV)
  const parenMatch = clean.match(/^(.*?)\s*\((?:season|sezon|series|\d)/i);
  if (parenMatch && parenMatch[1]) {
    const beforeParen = parenMatch[1].trim();
    const parts = beforeParen.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
      const candidateSeries = parts[parts.length - 1].trim();
      if (candidateSeries.length > 1) {
        return candidateSeries.toLowerCase().replace(/[^a-z0-9]/g, '');
      }
    } else if (beforeParen.length > 1) {
      return beforeParen.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
  }

  const match = clean.match(
    /^(.+?)(?:\s+\d+\.?\s*(?:sezon|season|bölüm|bolum|episode|series)|\s+s\d{1,2}e\d{1,3}|\s+\d{1,2}x\d{1,3}|(?:\s*[-|•–—]\s*(?:season|sezon|s\d|series)))/i
  );
  if (match && match[1].trim().length > 1) {
    return match[1].trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  return clean.toLowerCase().replace(/[^a-z0-9]/g, '') || 'dizi';
}

function extractSeasonAndEpisode(rawTitle = '', rawUrl = '') {
  // 1. Season & episode in title
  // e.g. "3. Sezon 3. Bölüm", "3. Sezon • 3. Bölüm", "1. Sezon, 2. Bölüm"
  const seTitleMatch1 = rawTitle.match(
    /(\d+)\s*\.?\s*(?:sezon|season|series)[\s•·\-–—|,:]*(\d+)\s*\.?\s*(?:b[öo]l[üu]m|episode|ep\.?)/i
  );
  if (seTitleMatch1) {
    return {
      season: Number(seTitleMatch1[1]),
      episode: Number(seTitleMatch1[2])
    };
  }

  // e.g. "Season 1, Episode 2", "Season 1 Episode 2", "Series 2, Episode 3", "Sezon 1, Bölüm 2"
  const seTitleMatch2 = rawTitle.match(
    /(?:sezon|season|series)\s*(\d+)[\s•·\-–—|,:]*(?:b[öo]l[üu]m|episode|ep\.?)\s*(\d+)/i
  );
  if (seTitleMatch2) {
    return {
      season: Number(seTitleMatch2[1]),
      episode: Number(seTitleMatch2[2])
    };
  }

  // e.g. "S02E05", "S2 E5"
  const seCompactMatch = rawTitle.match(/\bs(\d{1,2})\s*e(\d{1,3})\b/i);
  if (seCompactMatch) {
    return {
      season: Number(seCompactMatch[1]),
      episode: Number(seCompactMatch[2])
    };
  }

  // e.g. "2x05"
  const seXMatch = rawTitle.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (seXMatch) {
    return {
      season: Number(seXMatch[1]),
      episode: Number(seXMatch[2])
    };
  }

  // 2. Season & episode in URL
  const seUrlMatch =
    rawUrl.match(/(?:sezon|season)-(\d+)\/(?:bolum|episode)-(\d+)/i) ??
    rawUrl.match(/(\d+)-(?:sezon|season)-(\d+)-(?:bolum|episode)/i) ??
    rawUrl.match(/[-/](\d{1,2})x(\d{1,3})(?:$|[-/?#])/i) ??
    rawUrl.match(/[-/]s(\d{1,2})e(\d{1,3})(?:$|[-/?#])/i);

  if (seUrlMatch) {
    return {
      season: Number(seUrlMatch[1]),
      episode: Number(seUrlMatch[2])
    };
  }

  // 3. Episode-only in title or URL
  const epOnlyTitle =
    rawTitle.match(/(?:b[öo]l[üu]m|episode|ep\.?)\s*(\d+)/i) ??
    rawTitle.match(/(\d+)\s*\.?\s*(?:b[öo]l[üu]m|episode|ep\.?)/i);
  if (epOnlyTitle) {
    return { episode: Number(epOnlyTitle[1]) };
  }

  const epOnlyUrl =
    rawUrl.match(/(?:bolum|episode)-(\d+)/i) ??
    rawUrl.match(/(\d+)-(?:bolum|episode)/i);
  if (epOnlyUrl) {
    return { episode: Number(epOnlyUrl[1]) };
  }

  // 4. Season-only in title
  const seasonOnlyTitle =
    rawTitle.match(/(?:sezon|season|series)\s*(\d+)/i) ??
    rawTitle.match(/(\d+)\s*\.?\s*(?:sezon|season|series)/i);
  if (seasonOnlyTitle) {
    return { season: Number(seasonOnlyTitle[1]) };
  }

  return {};
}

function formatCleanSeriesAndEpisode(key, rawTitle = '', rawUrl = '') {
  const { season, episode } = extractSeasonAndEpisode(rawTitle, rawUrl);
  const episodeLabel =
    season && episode
      ? `${season}. Sezon • ${episode}. Bölüm`
      : episode
        ? `${episode}. Bölüm`
        : season
          ? `${season}. Sezon`
          : 'Son Bölüm';

  let cleaned = rawTitle
    .replace(
      /\b(apple\s*tv\+?|hbo\s*max|dizipal\d*|dizibox|dizigom\d*|dizilla|hdfilmcehennemi|filmmakinesi|selcukflix|yabancidizi(\.io)?)\b/gi,
      ''
    )
    .replace(/\s*\|\s*max\b/gi, '')
    .replace(/\s*-\s*max\b/gi, '')
    .replace(/^(?:watch|izle)\s+/i, '');

  // Apple TV pattern: "[Episode] - [Series] (Season X...)"
  const parenMatch = cleaned.match(/^(.*?)\s*\((?:season|sezon|series|\d)/i);
  if (parenMatch && parenMatch[1]) {
    const beforeParen = parenMatch[1].trim();
    const parts = beforeParen.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
      cleaned = parts[parts.length - 1].trim();
    } else if (beforeParen.length > 1) {
      cleaned = beforeParen;
    }
  } else {
    cleaned = cleaned
      .replace(/[-|•–—]\s*(?:season|sezon|series).*$/i, '')
      .replace(/(\d+)\s*\.?\s*(?:sezon|season|series).*$/i, '')
      .replace(/\bs\d{1,2}\s*e\d{1,3}\b.*$/i, '')
      .replace(/\b\d{1,2}x\d{1,3}\b.*$/i, '')
      .replace(/(\d+)\s*\.?\s*b[öo]l[üu]m.*$/i, '')
      .replace(/(?:episode|ep\.?)\s*\d+.*$/i, '')
      .replace(/\b(türkçe|turkce|dublaj|altyazılı|altyazili|izle|full|hd\d*|1080p)\b.*$/gi, '')
      .replace(/[|\-–—•]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!cleaned || cleaned.length < 2) {
    cleaned = key.charAt(0).toUpperCase() + key.slice(1);
  }

  return {
    seriesTitle: cleaned.slice(0, 60),
    episodeLabel,
    season,
    episode
  };
}

function isEpisodeUrl(url, title = '', customSites = []) {
  if (!url || !url.startsWith('https://')) return false;

  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  const isKnownSite = KNOWN_SITE_KEYWORDS.some((kw) => hostname.includes(kw));
  const isCustomSite = customSites.some((site) => {
    const cleanSite = site.trim().toLowerCase();
    return cleanSite && (hostname === cleanSite || hostname.endsWith('.' + cleanSite));
  });

  if (!isKnownSite && !isCustomSite) {
    return false;
  }

  // Check if URL or title indicates a series episode or show page
  const combined = `${url} ${title}`.toLowerCase();
  const hasEpisodePattern =
    /sezon|bolum|bölüm|season|episode|series|\b\d{1,2}x\d{1,3}\b|\bs\d{1,2}\s*e\d{1,3}\b|\/dizi\/|\/bolum\/|\/episode\/|\/video\/watch\/|\/show\//i.test(
      combined
    );

  return hasEpisodePattern;
}

async function getSettings() {
  const defaults = {
    serverUrl: 'http://localhost:3000',
    progressToken: '',
    delaySeconds: 60,
    customSites: [],
    autoSyncBookmarks: true
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}

/**
 * Searches the user's bookmarks for a folder named "dizi" (case-insensitive).
 * If not found, creates one under the Bookmarks Bar ("1").
 */
async function getOrCreateDiziFolder() {
  const tree = await chrome.bookmarks.getTree();

  function findDizi(node) {
    if (!node) return null;
    if (
      (!node.url && typeof node.title === 'string' && node.title.toLowerCase().includes('dizi')) ||
      (node.id !== '0' && node.id !== '1' && node.title && node.title.toLowerCase() === 'dizi')
    ) {
      return node.id;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findDizi(child);
        if (found) return found;
      }
    }
    return null;
  }

  const existingId = findDizi(tree[0]);
  if (existingId) return existingId;

  // Create under Bookmarks Bar (id "1")
  const created = await chrome.bookmarks.create({
    parentId: '1',
    title: 'dizi'
  });
  return created.id;
}

/**
 * Updates or creates exactly ONE bookmark per series in the "dizi" folder.
 */
async function syncBookmarkForSeries(title, url) {
  try {
    const folderId = await getOrCreateDiziFolder();
    const children = await chrome.bookmarks.getChildren(folderId);

    const targetKey = extractSeriesKey(title, url);
    const { seriesTitle, episodeLabel } = formatCleanSeriesAndEpisode(targetKey, title, url);
    const bookmarkTitle = `${seriesTitle} - ${episodeLabel}`;

    const matchingBookmarks = [];
    for (const child of children) {
      if (child.url) {
        const childKey = extractSeriesKey(child.title || '', child.url);
        if (childKey === targetKey) {
          matchingBookmarks.push(child);
        }
      }
    }

    if (matchingBookmarks.length > 0) {
      // Update the first one to latest URL & title
      await chrome.bookmarks.update(matchingBookmarks[0].id, {
        title: bookmarkTitle,
        url
      });

      // Remove any historical duplicate bookmarks for this series
      for (let i = 1; i < matchingBookmarks.length; i++) {
        await chrome.bookmarks.remove(matchingBookmarks[i].id).catch(() => {});
      }
    } else {
      // Create new bookmark
      await chrome.bookmarks.create({
        parentId: folderId,
        title: bookmarkTitle,
        url
      });
    }
  } catch (err) {
    console.error('[Background] Bookmark sync error:', err);
  }
}

/**
 * Sends episode progress to tv-controller backend
 */
async function sendProgressToServer(url, title) {
  const settings = await getSettings();
  const serverUrl = settings.serverUrl.replace(/\/+$/, '');

  const headers = { 'Content-Type': 'application/json' };
  if (settings.progressToken) {
    headers['X-Progress-Token'] = settings.progressToken;
  }

  const res = await fetch(`${serverUrl}/api/progress`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, title })
  });

  if (!res.ok) {
    throw new Error(`Server returned HTTP ${res.status}`);
  }

  return await res.json();
}

/**
 * Notifies the server about the active tab candidate (for instant remote button)
 */
async function notifyActiveTabCandidate(url, title) {
  try {
    const settings = await getSettings();
    const serverUrl = settings.serverUrl.replace(/\/+$/, '');

    const headers = { 'Content-Type': 'application/json' };
    if (settings.progressToken) {
      headers['X-Progress-Token'] = settings.progressToken;
    }

    await fetch(`${serverUrl}/api/progress/active-tab`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, title })
    });
  } catch {
    // Ignore server offline errors
  }
}

/**
 * Executes full save (server + chrome.bookmarks)
 */
async function executeSave(tabId, url, title) {
  try {
    await sendProgressToServer(url, title);

    const settings = await getSettings();
    if (settings.autoSyncBookmarks) {
      await syncBookmarkForSeries(title, url);
    }

    if (tabId) {
      await chrome.action.setBadgeText({ tabId, text: '✓' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#059669' });
    }

    // Record last saved
    await chrome.storage.local.set({
      lastSaved: {
        title,
        url,
        savedAt: Date.now()
      }
    });
  } catch (err) {
    console.warn('[Background] Failed to save progress:', err);
    if (tabId) {
      await chrome.action.setBadgeText({ tabId, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
    }
  }
}

// -------------------------------------------------------------
// Top-Level Event Listeners (Manifest V3 Service Worker Lifecycle)
// -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      serverUrl: 'http://localhost:3000',
      delaySeconds: 60,
      autoSyncBookmarks: true,
      customSites: []
    });
  }
});

async function handleTabEpisodeChange(tabId, currentUrl, currentTitle = '') {
  if (!currentUrl) return;

  const settings = await getSettings();
  const isMatch = isEpisodeUrl(currentUrl, currentTitle, settings.customSites);

  if (isMatch) {
    const sessionKey = `tab_${tabId}`;
    const sessionData = await chrome.storage.session.get(sessionKey);
    const existing = sessionData[sessionKey];

    // If already watching this exact URL on this tab, update title if it became available, and let timer run
    if (existing && existing.url === currentUrl) {
      if (currentTitle && currentTitle !== existing.title) {
        await chrome.storage.session.set({
          [sessionKey]: { ...existing, title: currentTitle }
        });
        await notifyActiveTabCandidate(currentUrl, currentTitle);
      }
      return;
    }

    // New episode opened on tab
    await chrome.storage.session.set({
      [sessionKey]: {
        tabId,
        url: currentUrl,
        title: currentTitle,
        startedAt: Date.now()
      }
    });

    // Notify server about candidate immediately
    await notifyActiveTabCandidate(currentUrl, currentTitle);

    // Show waiting badge
    await chrome.action.setBadgeText({ tabId, text: '⏱' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0891b2' });

    // Schedule delay alarm (e.g. 60 seconds)
    const delayMinutes = Math.max(0.5, (settings.delaySeconds || 60) / 60);
    chrome.alarms.create(`save-tab-${tabId}`, { delayInMinutes: delayMinutes });
  } else {
    // Navigated away from dizi page
    chrome.alarms.clear(`save-tab-${tabId}`);
    chrome.storage.session.remove(`tab_${tabId}`);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
}

// Watch tab navigations and title changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const currentUrl = tab.url || changeInfo.url;
  if (!currentUrl) return;
  await handleTabEpisodeChange(tabId, currentUrl, tab.title || '');
});

// Watch tab closures to clean up alarms
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.alarms.clear(`save-tab-${tabId}`);
  chrome.storage.session.remove(`tab_${tabId}`);
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith('save-tab-')) {
    const tabId = Number(alarm.name.replace('save-tab-', ''));
    if (!tabId) return;

    const sessionKey = `tab_${tabId}`;
    const sessionData = await chrome.storage.session.get(sessionKey);
    const data = sessionData[sessionKey];
    if (!data) return;

    // Check if the tab is still open and on the same URL
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url === data.url) {
        await executeSave(tabId, data.url, tab.title || data.title);
      }
    } catch {
      // Tab was closed
    } finally {
      await chrome.storage.session.remove(sessionKey);
    }
  }
});

// Message handling for popup / options / content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'PAGE_UPDATED': {
        const tabId = sender.tab?.id;
        if (tabId && msg.url) {
          await handleTabEpisodeChange(tabId, msg.url, msg.title || sender.tab?.title || '');
        }
        sendResponse({ ok: true });
        break;
      }

      case 'GET_STATUS': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id) {
          sendResponse({ ok: false, error: 'Aktif sekme bulunamadı' });
          return;
        }

        const settings = await getSettings();
        const isDizi = isEpisodeUrl(activeTab.url || '', activeTab.title || '', settings.customSites);
        const sessionData = await chrome.storage.session.get(`tab_${activeTab.id}`);
        const pending = sessionData[`tab_${activeTab.id}`];

        let hostname = '';
        try {
          hostname = new URL(activeTab.url || '').hostname;
        } catch {
          // ignore
        }

        let parsed = null;
        if (isDizi) {
          const key = extractSeriesKey(activeTab.title || '', activeTab.url || '');
          parsed = formatCleanSeriesAndEpisode(key, activeTab.title || '', activeTab.url || '');
        }

        sendResponse({
          ok: true,
          tabId: activeTab.id,
          url: activeTab.url,
          title: activeTab.title,
          hostname,
          isDizi,
          isPending: Boolean(pending),
          parsed,
          settings
        });
        break;
      }

      case 'SAVE_NOW': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.url) {
          sendResponse({ ok: false, error: 'Aktif sekme yok' });
          return;
        }
        await executeSave(activeTab.id, activeTab.url, activeTab.title || '');
        sendResponse({ ok: true });
        break;
      }

      case 'ADD_CUSTOM_SITE': {
        const domain = (msg.domain || '').trim().toLowerCase();
        if (!domain) {
          sendResponse({ ok: false, error: 'Geçersiz domain' });
          return;
        }
        const settings = await getSettings();
        const updated = Array.from(new Set([...settings.customSites, domain]));
        await chrome.storage.local.set({ customSites: updated });
        sendResponse({ ok: true, customSites: updated });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Bilinmeyen istek' });
        break;
    }
  })();

  return true; // Keep message channel open for async response
});
