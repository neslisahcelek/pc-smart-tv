import fs from 'node:fs';
import path from 'node:path';
import type { ShortcutItem } from '../shared/types.js';
import {
  FALLBACK_DIZI_BOOKMARKS,
  SERIES_ARTWORK_BY_KEY,
  isSafeHttpsUrl
} from '../shared/shortcuts.js';

interface BookmarkNode {
  type?: string;
  name?: string;
  url?: string;
  date_added?: string | number;
  children?: BookmarkNode[];
}

export interface RawDiziBookmark {
  name: string;
  url: string;
  dateAdded: number;
}

export function getColorForHost(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.includes('apple')) return '#475569';
  if (host.includes('max') || host.includes('hbomax')) return '#4f46e5';
  if (host.includes('dizigom')) return '#0891b2';
  if (host.includes('selcukflix')) return '#0d9488';
  if (host.includes('dizipal')) return '#4f46e5';
  if (host.includes('yabancidizi')) return '#d97706';
  if (host.includes('hdfilmcehennemi')) return '#ea580c';
  if (host.includes('filmmakinesi')) return '#db2777';
  if (host.includes('dizibox')) return '#059669';
  if (host.includes('dizilla')) return '#7c3aed';
  return '#3b6b82';
}

/**
 * Extracts a normalized series key from bookmark/page title and URL
 * so that all episodes belonging to the same series (e.g. "Death Note", "Friends")
 * share the exact same key.
 */
export function extractSeriesKey(title: string, rawUrl = ''): string {
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

export function extractSeasonAndEpisode(
  rawTitle: string,
  rawUrl: string
): { season?: number; episode?: number } {
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

  // 2. Try extracting season & episode from URL path
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

  // 3. Episode-only match in title or URL
  const epOnlyTitle =
    rawTitle.match(/(?:b[öo]l[üu]m|episode|ep\.?)\s*(\d+)/i) ??
    rawTitle.match(/(\d+)\s*\.?\s*(?:b[öo]l[üu]m|episode|ep\.?)/i);
  if (epOnlyTitle) {
    return {
      episode: Number(epOnlyTitle[1])
    };
  }

  const epOnlyUrl =
    rawUrl.match(/(?:bolum|episode)-(\d+)/i) ??
    rawUrl.match(/(\d+)-(?:bolum|episode)/i);
  if (epOnlyUrl) {
    return {
      episode: Number(epOnlyUrl[1])
    };
  }

  // 4. Season-only in title
  const seasonOnlyTitle =
    rawTitle.match(/(?:sezon|season|series)\s*(\d+)/i) ??
    rawTitle.match(/(\d+)\s*\.?\s*(?:sezon|season|series)/i);
  if (seasonOnlyTitle) {
    return {
      season: Number(seasonOnlyTitle[1])
    };
  }

  return {};
}

function humanizeUrlSlug(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const mDizi = u.pathname.match(/\/(?:dizi|show)\/([^/]+)/i);
    const candidate = mDizi?.[1] ?? u.pathname.split('/').filter(Boolean).pop() ?? '';
    const stripped = candidate
      .replace(/-izle.*$/i, '')
      .replace(/-\d+-sezon.*$/i, '')
      .replace(/-\d+x\d+.*$/i, '')
      .replace(/-sezon-\d+.*$/i, '')
      .replace(/-bolum-\d+.*$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    if (stripped.length >= 2) {
      return stripped.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } catch {
    // ignore
  }
  return '';
}

/**
 * Parses a raw bookmark/page title & URL into a clean Series Name and concise Season/Episode label,
 * stripping out noisy SEO suffixes ("izle", "Türkçe Dublaj", site names, etc.).
 */
export function formatCleanSeriesAndEpisode(
  key: string,
  rawTitle: string,
  rawUrl: string,
  overrideSeason?: number,
  overrideEpisode?: number
): { seriesTitle: string; episodeLabel: string; season?: number; episode?: number } {
  const extracted = extractSeasonAndEpisode(rawTitle, rawUrl);
  const season = overrideSeason ?? extracted.season;
  const episode = overrideEpisode ?? extracted.episode;

  const episodeLabel =
    season && episode
      ? `${season}. Sezon • ${episode}. Bölüm`
      : episode
        ? `${episode}. Bölüm`
        : season
          ? `${season}. Sezon`
          : 'Son Bölüm';

  // Known artwork dictionary has canonical series title
  if (SERIES_ARTWORK_BY_KEY[key]) {
    return {
      seriesTitle: SERIES_ARTWORK_BY_KEY[key].cleanTitle,
      episodeLabel,
      ...(season ? { season } : {}),
      ...(episode ? { episode } : {})
    };
  }

  // Otherwise clean up rawTitle to get a nice human-readable Series Title
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
    cleaned = humanizeUrlSlug(rawUrl) || key.charAt(0).toUpperCase() + key.slice(1);
  }

  return {
    seriesTitle: cleaned.slice(0, 60),
    episodeLabel,
    ...(season ? { season } : {}),
    ...(episode ? { episode } : {})
  };
}

function collectDiziBookmarks(node: BookmarkNode | undefined, out: RawDiziBookmark[]): void {
  if (!node || typeof node !== 'object') return;

  if (
    node.type === 'folder' &&
    typeof node.name === 'string' &&
    node.name.toLowerCase().includes('dizi') &&
    Array.isArray(node.children)
  ) {
    for (const child of node.children) {
      if (child.type === 'url' && typeof child.url === 'string' && isSafeHttpsUrl(child.url)) {
        const cleanUrl = child.url.trim();
        const rawTitle =
          typeof child.name === 'string' && child.name.trim() ? child.name.trim() : '';
        const dateAdded = Number(child.date_added) || 0;

        out.push({
          name: rawTitle,
          url: cleanUrl,
          dateAdded
        });
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectDiziBookmarks(child, out);
    }
  }
}

/**
 * Reads raw bookmark entries from the user's local Chrome/Edge "dizi" folder.
 * Used ONLY for one-time migration/import into data/progress.json.
 */
export function readRawChromeDiziBookmarks(): RawDiziBookmark[] {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return [];
  }

  const candidatePaths = [
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Bookmarks'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Bookmarks')
  ];

  const rawBookmarks: RawDiziBookmark[] = [];

  for (const bookmarkPath of candidatePaths) {
    try {
      if (!fs.existsSync(bookmarkPath)) continue;
      const raw = fs.readFileSync(bookmarkPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        roots?: {
          bookmark_bar?: BookmarkNode;
          other?: BookmarkNode;
          synced?: BookmarkNode;
        };
      };
      if (parsed.roots) {
        collectDiziBookmarks(parsed.roots.bookmark_bar, rawBookmarks);
        collectDiziBookmarks(parsed.roots.other, rawBookmarks);
        collectDiziBookmarks(parsed.roots.synced, rawBookmarks);
      }
      if (rawBookmarks.length > 0) {
        break;
      }
    } catch {
      // Ignore locked or unreadable file
    }
  }

  return rawBookmarks;
}

/**
 * One-time helper that reads the Chrome/Edge "dizi" bookmark folder and groups by series.
 * Runtime code should use loadProgress() / loadProgressAsShortcuts() from progress.ts instead.
 */
export function loadDiziBookmarks(): ShortcutItem[] {
  const rawBookmarks = readRawChromeDiziBookmarks();
  if (rawBookmarks.length === 0) {
    return FALLBACK_DIZI_BOOKMARKS;
  }

  const seriesMap = new Map<string, RawDiziBookmark>();

  for (const item of rawBookmarks) {
    const key = extractSeriesKey(item.name, item.url);
    const existing = seriesMap.get(key);

    if (!existing || item.dateAdded >= existing.dateAdded) {
      seriesMap.set(key, item);
    }
  }

  const result: ShortcutItem[] = [];

  for (const [key, item] of seriesMap.entries()) {
    let host = '';
    try {
      host = new URL(item.url).hostname.replace(/^www\./, '');
    } catch {
      // ignore
    }

    const { seriesTitle, episodeLabel } = formatCleanSeriesAndEpisode(key, item.name, item.url);
    const knownArtwork = SERIES_ARTWORK_BY_KEY[key]?.imageUrl;
    const imageUrl =
      knownArtwork ?? `/api/series-poster?q=${encodeURIComponent(seriesTitle)}`;

    result.push({
      id: `bm-series-${key}`,
      name: seriesTitle,
      subtitle: episodeLabel,
      url: item.url,
      category: 'bookmark',
      color: getColorForHost(host),
      badge: '',
      imageUrl
    });
  }

  return result;
}
