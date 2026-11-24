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
  'diziyou',
  'hdfilmcehennemi',
  'filmmakinesi',
  'selcukflix',
  'yabancidizi',
  'tv.apple.com',
  'max.com',
  'hbomax'
];

const AD_SKIP_SITE_KEYWORDS = [
  'dizipal',
  'dizibox',
  'dizigom',
  'dizilla',
  'diziyou',
  'hdfilmcehennemi',
  'filmmakinesi',
  'selcukflix',
  'yabancidizi'
];

const OFFICIAL_PLATFORM_HOSTS = [
  'youtube.com',
  'netflix.com',
  'tv.apple.com',
  'max.com',
  'hbomax.com',
  'primevideo.com',
  'disneyplus.com',
  'gain.tv'
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
      /\b(apple\s*tv\+?|hbo\s*max|dizipal\d*|dizibox|dizigom\d*|dizilla|diziyou|hdfilmcehennemi|filmmakinesi|selcukflix|yabancidizi(\.io)?)\b/gi,
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
    rawUrl.match(/(?:sezon|season)[-_](\d+)[-_](?:bolum|episode)[-_](\d+)/i) ??
    rawUrl.match(/(\d+)-(?:sezon|season)-(\d+)-(?:bolum|episode)/i) ??
    rawUrl.match(/[-/](\d{1,2})x(\d{1,3})(?:$|[-/?#])/i) ??
    rawUrl.match(/[-/]s(\d{1,2})[-_]?e(\d{1,3})(?:$|[-/?#])/i);

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
      /\b(apple\s*tv\+?|hbo\s*max|dizipal\d*|dizibox|dizigom\d*|dizilla|diziyou|hdfilmcehennemi|filmmakinesi|selcukflix|yabancidizi(\.io)?)\b/gi,
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

  // Require actual episode evidence (avoid saving series overview/detail pages like /show/... or /dizi/...)
  const se = extractSeasonAndEpisode(title, url);
  if (se.episode) {
    return true;
  }

  return /\/bolum\/|\/episode\/|\/video\/watch\//i.test(url);
}

function extractRootDomain(hostname = '') {
  const clean = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 2) return clean;
  return parts.slice(-2).join('.');
}

function isAdSkipSite(url, customSites = []) {
  if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
    return false;
  }

  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.')
  ) {
    return false;
  }

  const isOfficial = OFFICIAL_PLATFORM_HOSTS.some(
    (host) => hostname === host || hostname.endsWith('.' + host)
  );
  if (isOfficial) {
    return false;
  }

  if (AD_SKIP_SITE_KEYWORDS.some((kw) => hostname.includes(kw))) {
    return true;
  }

  return customSites.some((site) => {
    const cleanSite = String(site || '').trim().toLowerCase();
    return cleanSite && (hostname === cleanSite || hostname.endsWith('.' + cleanSite));
  });
}

async function getSettings() {
  const defaults = {
    serverUrl: 'http://localhost:3000',
    progressToken: '',
    delaySeconds: 60,
    newSeriesDelaySeconds: 300,
    customSites: [],
    autoSyncBookmarks: true,
    autoSkipAds: true,
    muteAndSpeedUpAds: true,
    closeAdPopups: true
  };
  const stored = await chrome.storage.local.get(defaults);
  return { ...defaults, ...stored };
}

async function incrementAdSkipCounter(tabId) {
  const { adsSkippedTotal = 0 } = await chrome.storage.local.get({ adsSkippedTotal: 0 });
  const nextTotal = Number(adsSkippedTotal) + 1;
  await chrome.storage.local.set({ adsSkippedTotal: nextTotal });

  let nextTabCount = 0;
  if (tabId) {
    const tabKey = `adSkipTab_${tabId}`;
    const sessionData = await chrome.storage.session.get(tabKey);
    nextTabCount = (Number(sessionData[tabKey]) || 0) + 1;
    await chrome.storage.session.set({ [tabKey]: nextTabCount });
  }

  return { tabCount: nextTabCount, totalCount: nextTotal };
}

async function tryCloseAdPopupTab(tabId, candidateUrl, openerTabId, openerRootDomain) {
  if (!tabId || !candidateUrl) return false;
  if (!candidateUrl.startsWith('http://') && !candidateUrl.startsWith('https://')) {
    return false;
  }

  let popupRootDomain = '';
  try {
    popupRootDomain = extractRootDomain(new URL(candidateUrl).hostname);
  } catch {
    return false;
  }

  // Never close navigation within the same series site
  if (openerRootDomain && popupRootDomain === openerRootDomain) {
    return false;
  }

  try {
    await chrome.tabs.remove(tabId);
    if (openerTabId) {
      await chrome.tabs.update(openerTabId, { active: true }).catch(() => {});
    }
    await incrementAdSkipCounter(openerTabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether a seriesKey is already tracked on the server (or in Chrome "dizi" bookmarks).
 * Existing series use delaySeconds (default 60s); new series require newSeriesDelaySeconds (default 300s).
 */
async function isSeriesAlreadyTracked(seriesKey, settings) {
  if (!seriesKey) return false;

  try {
    const cacheData = await chrome.storage.session.get('trackedKeysCache');
    const cache = cacheData.trackedKeysCache;
    if (cache && Array.isArray(cache.keys) && Date.now() - cache.fetchedAt < 60000) {
      return cache.keys.includes(seriesKey);
    }

    const serverUrl = settings.serverUrl.replace(/\/+$/, '');
    const headers = {};
    if (settings.progressToken) {
      headers['X-Progress-Token'] = settings.progressToken;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${serverUrl}/api/progress`, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      const keys = Array.isArray(json.entries)
        ? json.entries.map((e) => e.key).filter(Boolean)
        : [];
      await chrome.storage.session.set({
        trackedKeysCache: { keys, fetchedAt: Date.now() }
      });
      return keys.includes(seriesKey);
    }
  } catch {
    // Server offline — fall back to Chrome bookmarks check
  }

  try {
    const folderId = await getOrCreateDiziFolder();
    const children = await chrome.bookmarks.getChildren(folderId);
    return children.some((child) => {
      if (!child.url) return false;
      return extractSeriesKey(child.title || '', child.url) === seriesKey;
    });
  } catch {
    return false;
  }
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
async function syncBookmarkForSeries(title, url, savedEntry = null) {
  try {
    const folderId = await getOrCreateDiziFolder();
    const children = await chrome.bookmarks.getChildren(folderId);

    const targetKey = savedEntry?.key || extractSeriesKey(title, url);
    let bookmarkTitle = title;
    if (savedEntry?.title && savedEntry?.episodeLabel) {
      bookmarkTitle = `${savedEntry.title} - ${savedEntry.episodeLabel}`;
    } else {
      const { seriesTitle, episodeLabel } = formatCleanSeriesAndEpisode(targetKey, title, url);
      bookmarkTitle = `${seriesTitle} - ${episodeLabel}`;
    }

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
async function sendProgressToServer(url, title, { completed = false } = {}) {
  const settings = await getSettings();
  const serverUrl = settings.serverUrl.replace(/\/+$/, '');

  const headers = { 'Content-Type': 'application/json' };
  if (settings.progressToken) {
    headers['X-Progress-Token'] = settings.progressToken;
  }

  const res = await fetch(`${serverUrl}/api/progress`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url, title, completed })
  });

  if (!res.ok) {
    throw new Error(`Server returned HTTP ${res.status}`);
  }

  // Invalidate tracked keys cache so subsequent checks know this series is tracked
  await chrome.storage.session.remove('trackedKeysCache').catch(() => {});

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
async function executeSave(tabId, url, title, { completed = false } = {}) {
  try {
    const result = await sendProgressToServer(url, title, { completed });
    const savedEntry = result?.entry || null;
    const finalUrl = savedEntry?.url || url;
    const finalTitle = savedEntry?.title || title;

    const settings = await getSettings();
    if (settings.autoSyncBookmarks) {
      await syncBookmarkForSeries(title, finalUrl, savedEntry);
    }

    if (tabId) {
      await chrome.action.setBadgeText({ tabId, text: completed ? '⏭' : '✓' });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#059669' });
    }

    // Record last saved
    await chrome.storage.local.set({
      lastSaved: {
        title: finalTitle,
        url: finalUrl,
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
      newSeriesDelaySeconds: 300,
      autoSyncBookmarks: true,
      autoSkipAds: true,
      muteAndSpeedUpAds: true,
      closeAdPopups: true,
      adsSkippedTotal: 0,
      customSites: []
    });
  }
});

async function handleTabEpisodeChange(tabId, currentUrl, currentTitle = '', domHint = '') {
  if (!currentUrl) return;

  const settings = await getSettings();
  const titleForMatch =
    !extractSeasonAndEpisode(currentTitle, currentUrl).episode && domHint
      ? `${currentTitle} ${domHint}`.trim()
      : currentTitle;

  const isMatch = isEpisodeUrl(currentUrl, titleForMatch, settings.customSites);

  if (isMatch) {
    const sessionKey = `tab_${tabId}`;
    const sessionData = await chrome.storage.session.get(sessionKey);
    const existing = sessionData[sessionKey];

    // If already tracking this exact URL on this tab, update title if it became available
    if (existing && existing.url === currentUrl) {
      if (titleForMatch && titleForMatch !== existing.title) {
        await chrome.storage.session.set({
          [sessionKey]: { ...existing, title: titleForMatch }
        });
        await notifyActiveTabCandidate(currentUrl, titleForMatch);
      }
      return;
    }

    const seriesKey = extractSeriesKey(titleForMatch, currentUrl);
    const isExistingSeries = await isSeriesAlreadyTracked(seriesKey, settings);
    const requiredSeconds = isExistingSeries
      ? Number(settings.delaySeconds) || 60
      : Number(settings.newSeriesDelaySeconds) || 300;

    // New episode opened on tab — wait for real playback / active watching
    await chrome.storage.session.set({
      [sessionKey]: {
        tabId,
        url: currentUrl,
        title: titleForMatch,
        seriesKey,
        isExistingSeries,
        requiredSeconds,
        hasHeartbeat: false,
        hasVideo: false,
        hasIframe: false,
        isPlaying: false,
        videoWatchedSeconds: 0,
        fallbackWatchedSeconds: 0,
        lastFallbackTickAt: Date.now(),
        savedCurrent: false,
        savedCompleted: false,
        startedAt: Date.now()
      }
    });

    // Fallback periodic alarm in case content.js cannot inject on mirror domains or customSites
    chrome.alarms.create(`watch-fallback-${tabId}`, { periodInMinutes: 0.5 });

    // Notify server about candidate immediately
    await notifyActiveTabCandidate(currentUrl, titleForMatch);

    // Show waiting badge
    await chrome.action.setBadgeText({ tabId, text: '⏱' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0891b2' });
  } else {
    // Navigated away from episode page
    chrome.alarms.clear(`watch-fallback-${tabId}`);
    chrome.storage.session.remove(`tab_${tabId}`);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
}

async function handlePlaybackHeartbeat(tabId, msg) {
  const sessionKey = `tab_${tabId}`;
  let sessionData = await chrome.storage.session.get(sessionKey);
  let state = sessionData[sessionKey];

  // If top frame navigated or title updated before tabs.onUpdated fired, ensure state exists
  if (!state && msg.isTopFrame && msg.url) {
    await handleTabEpisodeChange(tabId, msg.url, msg.title || '');
    sessionData = await chrome.storage.session.get(sessionKey);
    state = sessionData[sessionKey];
  }

  if (!state) return;

  if (!state.hasHeartbeat) {
    state.hasHeartbeat = true;
    chrome.alarms.clear(`watch-fallback-${tabId}`).catch(() => {});
  }

  const now = Date.now();
  if (msg.isTopFrame && msg.title && !state.title) {
    state.title = msg.title;
  }
  if (msg.hasIframe) {
    state.hasIframe = true;
  }

  const reportedDuration = Number(msg.duration) || 0;
  const reportedCurrentTime = Number(msg.currentTime) || 0;
  const isValidEpisodeVideo = Boolean(msg.hasVideo) && !(reportedDuration > 0 && reportedDuration < 180);

  if (isValidEpisodeVideo) {
    state.hasVideo = true;
    state.isPlaying = Boolean(msg.isPlaying);
    const reportedWatched = Number(msg.watchedSeconds) || 0;
    if (reportedWatched > state.videoWatchedSeconds) {
      state.videoWatchedSeconds = reportedWatched;
    }
  } else if (!state.hasVideo) {
    // Fallback for cross-origin iframe players where <video> is inaccessible:
    // only count time while the tab is actively being watched (focused & visible or audible).
    let isActivelyWatching = false;
    try {
      const tab = await chrome.tabs.get(tabId);
      const win = await chrome.windows.get(tab.windowId);
      isActivelyWatching =
        Boolean(tab.audible) || (Boolean(tab.active) && Boolean(win.focused) && Boolean(msg.isVisible));
    } catch {
      isActivelyWatching = false;
    }

    if (isActivelyWatching) {
      if (state.lastFallbackTickAt) {
        const deltaSec = (now - state.lastFallbackTickAt) / 1000;
        if (deltaSec > 0 && deltaSec <= 25) {
          state.fallbackWatchedSeconds += deltaSec;
        }
      }
      state.lastFallbackTickAt = now;
    } else {
      state.lastFallbackTickAt = null;
    }
  }

  const effectiveSeconds = state.hasVideo
    ? state.videoWatchedSeconds
    : state.fallbackWatchedSeconds;

  // 1. Save current episode once required watch threshold is met
  if (!state.savedCurrent && effectiveSeconds >= state.requiredSeconds) {
    state.savedCurrent = true;
    await chrome.storage.session.set({ [sessionKey]: state });
    await executeSave(tabId, state.url, state.title, { completed: false });
  }

  // 2. If episode finished (ended or near end) on a real >=5min episode video that was actually watched, save next episode (+1)
  const isCompletedLongEpisode =
    isValidEpisodeVideo &&
    reportedDuration >= 300 &&
    reportedCurrentTime >= reportedDuration * 0.88 &&
    (Boolean(msg.ended) || Boolean(msg.isNearEnd));

  if (
    isCompletedLongEpisode &&
    !state.savedCompleted &&
    state.videoWatchedSeconds >= 60
  ) {
    state.savedCompleted = true;
    state.savedCurrent = true;
    await chrome.storage.session.set({ [sessionKey]: state });
    await executeSave(tabId, state.url, state.title, { completed: true });
    return;
  }

  await chrome.storage.session.set({ [sessionKey]: state });
}

// Watch newly opened tabs for popunders triggered right when auto-skip clicks a skip button
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab?.id || !tab.openerTabId) return;

  const armedKey = `adSkipArmed_${tab.openerTabId}`;
  const sessionData = await chrome.storage.session.get(armedKey);
  const armed = sessionData[armedKey];
  if (!armed || Date.now() - armed.armedAt > 2500) {
    return;
  }

  const settings = await getSettings();
  if (!settings.autoSkipAds || !settings.closeAdPopups) {
    return;
  }

  const candidateUrl = tab.pendingUrl || tab.url || '';
  if (!candidateUrl || candidateUrl === 'about:blank') {
    await chrome.storage.session.set({
      [`pendingPopupTab_${tab.id}`]: {
        openerTabId: tab.openerTabId,
        openerRootDomain: armed.openerRootDomain || '',
        createdAt: Date.now()
      }
    });
    return;
  }

  await tryCloseAdPopupTab(tab.id, candidateUrl, tab.openerTabId, armed.openerRootDomain || '');
});

// Watch tab navigations and title changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const currentUrl = changeInfo.url || tab.url;
  if (!currentUrl) return;

  // Check if this tab was flagged as a blank popunder waiting for redirect URL
  if (changeInfo.url) {
    const popupKey = `pendingPopupTab_${tabId}`;
    const popupData = await chrome.storage.session.get(popupKey);
    const pendingPopup = popupData[popupKey];
    if (pendingPopup) {
      await chrome.storage.session.remove(popupKey);
      if (Date.now() - pendingPopup.createdAt <= 3500) {
        const closed = await tryCloseAdPopupTab(
          tabId,
          changeInfo.url,
          pendingPopup.openerTabId,
          pendingPopup.openerRootDomain
        );
        if (closed) return;
      }
    }
  }

  await handleTabEpisodeChange(tabId, currentUrl, tab.title || '');
});

// Watch tab closures to clean up alarms and session state
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.alarms.clear(`watch-fallback-${tabId}`);
  chrome.storage.session.remove([
    `tab_${tabId}`,
    `adSkipArmed_${tabId}`,
    `adSkipTab_${tabId}`,
    `pendingPopupTab_${tabId}`
  ]);
});

// Handle alarms (fallback active-watch tracker when content.js is not injected on a mirror/custom domain)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('watch-fallback-')) return;
  const tabId = Number(alarm.name.replace('watch-fallback-', ''));
  if (!tabId) return;

  const sessionKey = `tab_${tabId}`;
  const sessionData = await chrome.storage.session.get(sessionKey);
  const state = sessionData[sessionKey];
  if (!state || state.hasHeartbeat || state.savedCurrent) {
    chrome.alarms.clear(alarm.name).catch(() => {});
    return;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.url !== state.url) {
      chrome.alarms.clear(alarm.name).catch(() => {});
      return;
    }

    const win = await chrome.windows.get(tab.windowId);
    const isActivelyWatching = Boolean(tab.audible) || (Boolean(tab.active) && Boolean(win.focused));
    const now = Date.now();

    if (isActivelyWatching) {
      if (state.lastFallbackTickAt) {
        const deltaSec = (now - state.lastFallbackTickAt) / 1000;
        if (deltaSec > 0 && deltaSec <= 90) {
          state.fallbackWatchedSeconds += deltaSec;
        }
      }
      state.lastFallbackTickAt = now;
    } else {
      state.lastFallbackTickAt = null;
    }

    if (tab.title && !state.title) {
      state.title = tab.title;
    }

    if (!state.savedCurrent && state.fallbackWatchedSeconds >= state.requiredSeconds) {
      state.savedCurrent = true;
      await chrome.storage.session.set({ [sessionKey]: state });
      await executeSave(tabId, state.url, tab.title || state.title, { completed: false });
      chrome.alarms.clear(alarm.name).catch(() => {});
      return;
    }

    await chrome.storage.session.set({ [sessionKey]: state });
  } catch {
    // Tab was closed
    chrome.alarms.clear(alarm.name).catch(() => {});
    await chrome.storage.session.remove(sessionKey);
  }
});

// Message handling for popup / options / content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'PAGE_UPDATED': {
        const tabId = sender.tab?.id;
        if (tabId && msg.url) {
          await handleTabEpisodeChange(
            tabId,
            msg.url,
            msg.title || sender.tab?.title || '',
            msg.domHint || ''
          );
        }
        sendResponse({ ok: true });
        break;
      }

      case 'PLAYBACK_HEARTBEAT': {
        const tabId = sender.tab?.id;
        if (tabId) {
          await handlePlaybackHeartbeat(tabId, msg);
        }
        sendResponse({ ok: true });
        break;
      }

      case 'GET_AD_SKIPPER_CONFIG': {
        const tabUrl = sender.tab?.url || '';
        const settings = await getSettings();
        const siteSupported = isAdSkipSite(tabUrl, settings.customSites);
        sendResponse({
          ok: true,
          siteSupported,
          enabled: siteSupported && settings.autoSkipAds !== false,
          muteAndSpeedUpAds: settings.muteAndSpeedUpAds !== false,
          closeAdPopups: settings.closeAdPopups !== false
        });
        break;
      }

      case 'AD_SKIP_ARMED': {
        const tabId = sender.tab?.id;
        const tabUrl = sender.tab?.url || '';
        if (tabId) {
          let openerRootDomain = '';
          try {
            openerRootDomain = extractRootDomain(new URL(tabUrl).hostname);
          } catch {
            openerRootDomain = '';
          }
          await chrome.storage.session.set({
            [`adSkipArmed_${tabId}`]: {
              armedAt: Date.now(),
              openerRootDomain
            }
          });
        }
        sendResponse({ ok: true });
        break;
      }

      case 'AD_SKIPPED': {
        const tabId = sender.tab?.id;
        const counts = await incrementAdSkipCounter(tabId);
        sendResponse({ ok: true, ...counts });
        break;
      }

      case 'SET_AD_SKIP_ENABLED': {
        const enabled = Boolean(msg.enabled);
        await chrome.storage.local.set({ autoSkipAds: enabled });
        sendResponse({ ok: true, autoSkipAds: enabled });
        break;
      }

      case 'GET_STATUS': {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id) {
          sendResponse({ ok: false, error: 'Aktif sekme bulunamadı' });
          return;
        }

        const settings = await getSettings();
        const sessionData = await chrome.storage.session.get([
          `tab_${activeTab.id}`,
          `adSkipTab_${activeTab.id}`
        ]);
        const pending = sessionData[`tab_${activeTab.id}`];
        const tabAdsSkipped = Number(sessionData[`adSkipTab_${activeTab.id}`]) || 0;
        const { adsSkippedTotal = 0 } = await chrome.storage.local.get({ adsSkippedTotal: 0 });
        const effectiveTitle = pending?.title || activeTab.title || '';
        const isDizi =
          Boolean(pending) ||
          isEpisodeUrl(activeTab.url || '', effectiveTitle, settings.customSites);
        const adSkipSite = isAdSkipSite(activeTab.url || '', settings.customSites);

        let hostname = '';
        try {
          hostname = new URL(activeTab.url || '').hostname;
        } catch {
          // ignore
        }

        let parsed = null;
        if (isDizi) {
          const key = extractSeriesKey(effectiveTitle, activeTab.url || '');
          parsed = formatCleanSeriesAndEpisode(key, effectiveTitle, activeTab.url || '');
        }

        const watchedSeconds = pending
          ? Math.floor(pending.hasVideo ? pending.videoWatchedSeconds : pending.fallbackWatchedSeconds)
          : 0;

        sendResponse({
          ok: true,
          tabId: activeTab.id,
          url: activeTab.url,
          title: effectiveTitle,
          hostname,
          isDizi,
          isAdSkipSite: adSkipSite,
          tabAdsSkipped,
          adsSkippedTotal: Number(adsSkippedTotal) || 0,
          isPending: Boolean(pending && !pending.savedCurrent),
          watchState: pending
            ? {
                isExistingSeries: Boolean(pending.isExistingSeries),
                requiredSeconds: pending.requiredSeconds,
                watchedSeconds,
                hasVideo: Boolean(pending.hasVideo),
                isPlaying: Boolean(pending.isPlaying),
                savedCurrent: Boolean(pending.savedCurrent),
                savedCompleted: Boolean(pending.savedCompleted)
              }
            : null,
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
