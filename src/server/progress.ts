import fs from 'node:fs';
import path from 'node:path';
import type { ProgressEntry, ShortcutItem } from '../shared/types.js';
import {
  FALLBACK_DIZI_BOOKMARKS,
  SERIES_ARTWORK_BY_KEY,
  isSafeHttpsUrl
} from '../shared/shortcuts.js';
import {
  extractSeasonAndEpisode,
  extractSeriesKey,
  formatCleanSeriesAndEpisode,
  getColorForHost,
  readRawChromeDiziBookmarks
} from './bookmarks.js';

export type { ProgressEntry } from '../shared/types.js';

interface ProgressFileSchema {
  version: number;
  importedFromChromeAt?: number;
  updatedAt: number;
  entries: ProgressEntry[];
}

export interface UpsertProgressInput {
  url: string;
  title?: string;
  season?: number;
  episode?: number;
  updatedAt?: number;
}

export function getDefaultProgressFilePath(): string {
  return path.resolve(process.cwd(), 'data', 'progress.json');
}

function extractHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Atomically writes the progress entries to disk using a temporary file + rename.
 */
export function writeProgressAtomic(
  entries: ProgressEntry[],
  filePath: string = getDefaultProgressFilePath(),
  importedFromChromeAt?: number
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  const payload: ProgressFileSchema = {
    version: 1,
    ...(importedFromChromeAt ? { importedFromChromeAt } : {}),
    updatedAt: Date.now(),
    entries: sorted
  };

  const json = JSON.stringify(payload, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;

  try {
    fs.writeFileSync(tmpPath, json, 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Fallback for Windows if rename briefly contends with an open handle
    fs.writeFileSync(filePath, json, 'utf8');
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup error
    }
  }
}

function buildFallbackProgressEntries(): ProgressEntry[] {
  const now = Date.now();
  return FALLBACK_DIZI_BOOKMARKS.map((item, idx) => {
    const key = item.id.replace(/^bm-series-/, '') || extractSeriesKey(item.name, item.url);
    const { season, episode } = extractSeasonAndEpisode(
      `${item.name} ${item.subtitle}`,
      item.url
    );
    return {
      key,
      title: item.name,
      ...(season ? { season } : {}),
      ...(episode ? { episode } : {}),
      episodeLabel: item.subtitle || 'Son Bölüm',
      url: item.url,
      host: extractHost(item.url),
      updatedAt: now - idx * 1000
    };
  });
}

/**
 * One-time migration from the user's local Chrome/Edge "dizi" bookmark folder
 * into data/progress.json. Falls back to FALLBACK_DIZI_BOOKMARKS if no Chrome bookmarks exist.
 */
export function importFromChromeBookmarks(
  filePath: string | null = getDefaultProgressFilePath()
): ProgressEntry[] {
  const rawBookmarks = readRawChromeDiziBookmarks();
  let entries: ProgressEntry[];

  if (rawBookmarks.length === 0) {
    entries = buildFallbackProgressEntries();
  } else {
    const seriesMap = new Map<string, { name: string; url: string; dateAdded: number }>();

    for (const item of rawBookmarks) {
      const key = extractSeriesKey(item.name, item.url);
      const existing = seriesMap.get(key);
      if (!existing || item.dateAdded >= existing.dateAdded) {
        seriesMap.set(key, item);
      }
    }

    const now = Date.now();
    let offset = 0;
    entries = [];

    for (const [key, item] of seriesMap.entries()) {
      const { seriesTitle, episodeLabel, season, episode } = formatCleanSeriesAndEpisode(
        key,
        item.name,
        item.url
      );
      entries.push({
        key,
        title: seriesTitle,
        ...(season ? { season } : {}),
        ...(episode ? { episode } : {}),
        episodeLabel,
        url: item.url,
        host: extractHost(item.url),
        updatedAt: now - offset * 1000
      });
      offset++;
    }
  }

  if (filePath) {
    try {
      writeProgressAtomic(entries, filePath, Date.now());
    } catch {
      // Ignore write failures in read-only environments
    }
  }

  return entries;
}

function sanitizeLoadedEntry(raw: unknown): ProgressEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!isSafeHttpsUrl(url)) return null;

  const rawTitle = typeof obj.title === 'string' ? obj.title.trim() : '';
  const key =
    typeof obj.key === 'string' && obj.key.trim()
      ? obj.key.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
      : extractSeriesKey(rawTitle, url);

  if (!key) return null;

  const rawSeason =
    typeof obj.season === 'number' && Number.isInteger(obj.season) && obj.season > 0
      ? obj.season
      : undefined;
  const rawEpisode =
    typeof obj.episode === 'number' && Number.isInteger(obj.episode) && obj.episode > 0
      ? obj.episode
      : undefined;

  const { seriesTitle, episodeLabel, season, episode } = formatCleanSeriesAndEpisode(
    key,
    rawTitle,
    url,
    rawSeason,
    rawEpisode
  );

  const finalEpisodeLabel =
    typeof obj.episodeLabel === 'string' && obj.episodeLabel.trim()
      ? obj.episodeLabel.trim()
      : episodeLabel;

  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : Date.now();

  return {
    key,
    title: rawTitle || seriesTitle,
    ...(season ? { season } : {}),
    ...(episode ? { episode } : {}),
    episodeLabel: finalEpisodeLabel,
    url,
    host: typeof obj.host === 'string' && obj.host.trim() ? obj.host.trim() : extractHost(url),
    updatedAt
  };
}

/**
 * Loads series progress from data/progress.json.
 * Performs a one-time automatic import from Chrome bookmarks if data/progress.json does not exist yet.
 */
export function loadProgress(
  filePath: string | null = getDefaultProgressFilePath()
): ProgressEntry[] {
  if (!filePath) {
    return buildFallbackProgressEntries();
  }

  if (!fs.existsSync(filePath)) {
    if (path.resolve(filePath) === path.resolve(getDefaultProgressFilePath())) {
      return importFromChromeBookmarks(filePath);
    }
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ProgressFileSchema | ProgressEntry[];
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)
        ? parsed.entries
        : null;

    if (!list) {
      return importFromChromeBookmarks(filePath);
    }

    const deduped = new Map<string, ProgressEntry>();
    for (const item of list) {
      const valid = sanitizeLoadedEntry(item);
      if (!valid) continue;
      const existing = deduped.get(valid.key);
      if (!existing || valid.updatedAt >= existing.updatedAt) {
        deduped.set(valid.key, valid);
      }
    }

    return Array.from(deduped.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return buildFallbackProgressEntries();
  }
}

/**
 * Inserts or updates the latest watched episode for a series in data/progress.json.
 * Strictly keeps ONE entry per series key.
 */
export function upsertProgress(
  input: UpsertProgressInput,
  filePath: string = getDefaultProgressFilePath()
): ProgressEntry {
  const cleanUrl = typeof input.url === 'string' ? input.url.trim() : '';
  if (!isSafeHttpsUrl(cleanUrl)) {
    throw new Error('Progress URL must be a valid https:// address.');
  }

  const rawTitle = typeof input.title === 'string' ? input.title.trim() : '';
  const key = extractSeriesKey(rawTitle, cleanUrl);
  const existingEntries = loadProgress(filePath);
  const existing = existingEntries.find((e) => e.key === key);

  const overrideSeason =
    typeof input.season === 'number' && Number.isInteger(input.season) && input.season > 0
      ? input.season
      : undefined;
  const overrideEpisode =
    typeof input.episode === 'number' && Number.isInteger(input.episode) && input.episode > 0
      ? input.episode
      : undefined;

  const { seriesTitle, episodeLabel, season, episode } = formatCleanSeriesAndEpisode(
    key,
    rawTitle || existing?.title || '',
    cleanUrl,
    overrideSeason,
    overrideEpisode
  );

  const entry: ProgressEntry = {
    key,
    title: seriesTitle,
    ...(season ? { season } : {}),
    ...(episode ? { episode } : {}),
    episodeLabel,
    url: cleanUrl,
    host: extractHost(cleanUrl),
    updatedAt:
      typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : Date.now()
  };

  const remaining = existingEntries.filter((e) => e.key !== key);
  const updatedList = [entry, ...remaining];
  writeProgressAtomic(updatedList, filePath);

  return entry;
}

/**
 * Computes the next episode URL and label for a ProgressEntry.
 */
export function buildNextEpisode(entry: ProgressEntry): {
  url: string;
  season?: number;
  episode: number;
  episodeLabel: string;
} {
  const extracted = extractSeasonAndEpisode(`${entry.title} ${entry.episodeLabel}`, entry.url);
  const season = entry.season ?? extracted.season;
  const currentEpisode = entry.episode ?? extracted.episode ?? 1;
  const nextEp = currentEpisode + 1;

  let nextUrl = entry.url;
  if (/(sezon-\d+\/bolum-)(\d+)/i.test(nextUrl)) {
    nextUrl = nextUrl.replace(/(sezon-\d+\/bolum-)(\d+)/i, `$1${nextEp}`);
  } else if (/(\d+-sezon-)(\d+)(-bolum)/i.test(nextUrl)) {
    nextUrl = nextUrl.replace(/(\d+-sezon-)(\d+)(-bolum)/i, `$1${nextEp}$3`);
  } else if (/([-/]\d{1,2}x)(\d{1,3})($|[-/?#])/i.test(nextUrl)) {
    nextUrl = nextUrl.replace(/([-/]\d{1,2}x)(\d{1,3})($|[-/?#])/i, `$1${nextEp}$3`);
  } else if (/([-/]s\d{1,2}e)(\d{1,3})($|[-/?#])/i.test(nextUrl)) {
    nextUrl = nextUrl.replace(
      /([-/]s\d{1,2}e)(\d{1,3})($|[-/?#])/i,
      `$1${String(nextEp).padStart(2, '0')}$3`
    );
  } else if (/(bolum-)(\d+)/i.test(nextUrl)) {
    nextUrl = nextUrl.replace(/(bolum-)(\d+)/i, `$1${nextEp}`);
  } else if (/(\d+)(-bolum)/i.test(nextUrl)) {
    nextUrl = nextUrl.replace(/(\d+)(-bolum)/i, `${nextEp}$2`);
  }

  const episodeLabel = season
    ? `${season}. Sezon • ${nextEp}. Bölüm`
    : `${nextEp}. Bölüm`;

  return {
    url: nextUrl,
    ...(season ? { season } : {}),
    episode: nextEp,
    episodeLabel
  };
}

/**
 * Advances a series to the next episode (+1) in data/progress.json.
 */
export function advanceProgressEpisode(
  rawKey: string,
  filePath: string = getDefaultProgressFilePath()
): ProgressEntry | null {
  const cleanKey = rawKey.trim().replace(/^bm-series-/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanKey) return null;

  const entries = loadProgress(filePath);
  const existing = entries.find((e) => e.key === cleanKey);
  if (!existing) return null;

  const next = buildNextEpisode(existing);
  const updated: ProgressEntry = {
    ...existing,
    ...(next.season ? { season: next.season } : {}),
    episode: next.episode,
    episodeLabel: next.episodeLabel,
    url: next.url,
    updatedAt: Date.now()
  };

  const remaining = entries.filter((e) => e.key !== cleanKey);
  writeProgressAtomic([updated, ...remaining], filePath);
  return updated;
}

/**
 * Deletes a series progress entry by key (or shortcut ID 'bm-series-<key>').
 */
export function deleteProgress(
  rawKey: string,
  filePath: string = getDefaultProgressFilePath()
): boolean {
  const cleanKey = rawKey.trim().replace(/^bm-series-/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanKey) return false;

  const entries = loadProgress(filePath);
  const filtered = entries.filter((e) => e.key !== cleanKey);
  if (filtered.length === entries.length) {
    return false;
  }

  writeProgressAtomic(filtered, filePath);
  return true;
}

/**
 * Converts a ProgressEntry into a TV/Remote ShortcutItem of category 'bookmark'.
 */
export function progressEntryToShortcut(entry: ProgressEntry): ShortcutItem {
  const knownArtwork = SERIES_ARTWORK_BY_KEY[entry.key]?.imageUrl;
  const imageUrl = knownArtwork ?? `/api/series-poster?q=${encodeURIComponent(entry.title)}`;

  return {
    id: `bm-series-${entry.key}`,
    name: entry.title,
    subtitle: entry.episodeLabel,
    url: entry.url,
    category: 'bookmark',
    color: getColorForHost(entry.host),
    badge: '',
    imageUrl
  };
}

/**
 * Loads progress entries from data/progress.json and maps them to ShortcutItem[].
 */
export function loadProgressAsShortcuts(
  filePath: string | null = getDefaultProgressFilePath()
): ShortcutItem[] {
  return loadProgress(filePath).map(progressEntryToShortcut);
}
