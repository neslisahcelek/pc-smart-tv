import type { YouTubeSearchResult } from '../shared/types.js';
import { sanitizeSearchQuery } from '../shared/protocol.js';

export type YouTubeSearchErrorCode =
  | 'NO_API_KEY'
  | 'INVALID_QUERY'
  | 'QUOTA_EXCEEDED'
  | 'UPSTREAM_ERROR';

export interface YouTubeSearchResponse {
  ok: boolean;
  query: string;
  fallbackSearchUrl: string;
  results: YouTubeSearchResult[];
  cached?: boolean;
  errorCode?: YouTubeSearchErrorCode;
  errorMessage?: string;
}

interface CacheEntry {
  expiresAt: number;
  results: YouTubeSearchResult[];
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export class YouTubeSearchService {
  private readonly apiKey: string | null;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly playlistCache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly playlistTtlMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    apiKey: string | null;
    ttlMs?: number;
    playlistTtlMs?: number;
    fetchImpl?: typeof fetch;
  }) {
    this.apiKey = options.apiKey;
    this.ttlMs = options.ttlMs ?? 15 * 60 * 1000; // 15 minutes default TTL for search
    this.playlistTtlMs = options.playlistTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours default TTL (manual refresh preferred to save quota)
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  public async searchVideos(rawQuery: unknown): Promise<YouTubeSearchResponse> {
    const query = sanitizeSearchQuery(rawQuery);
    if (!query) {
      return {
        ok: false,
        query: '',
        fallbackSearchUrl: 'https://www.youtube.com',
        results: [],
        errorCode: 'INVALID_QUERY',
        errorMessage: 'Lütfen geçerli bir arama terimi girin.'
      };
    }

    const fallbackSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    if (!this.apiKey) {
      return {
        ok: false,
        query,
        fallbackSearchUrl,
        results: [],
        errorCode: 'NO_API_KEY',
        errorMessage:
          'YouTube API anahtarı (.env içinde YOUTUBE_API_KEY) tanımlanmamış. Aramayı doğrudan TV tarayıcısında açabilir veya doğrudan YouTube video linki yapıştırabilirsiniz.'
      };
    }

    const cacheKey = query.toLowerCase();
    const now = Date.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return {
        ok: true,
        query,
        fallbackSearchUrl,
        results: cached.results,
        cached: true
      };
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('maxResults', '12');
    url.searchParams.set('q', query);
    url.searchParams.set('key', this.apiKey);

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        let isQuota = response.status === 429;
        try {
          const errBody = (await response.json()) as {
            error?: {
              errors?: Array<{ reason?: string }>;
            };
          };
          const reasons = errBody.error?.errors?.map((e) => e.reason) ?? [];
          if (reasons.includes('quotaExceeded') || reasons.includes('dailyLimitExceeded')) {
            isQuota = true;
          }
        } catch {
          // ignore body parse failure
        }

        if (isQuota) {
          return {
            ok: false,
            query,
            fallbackSearchUrl,
            results: [],
            errorCode: 'QUOTA_EXCEEDED',
            errorMessage:
              'Günlük YouTube Data API kotası doldu. Aramayı doğrudan TV tarayıcısında açabilirsiniz.'
          };
        }

        return {
          ok: false,
          query,
          fallbackSearchUrl,
          results: [],
          errorCode: 'UPSTREAM_ERROR',
          errorMessage: `YouTube API isteği başarısız oldu (HTTP ${response.status}). Aramayı TV tarayıcısında açabilirsiniz.`
        };
      }

      const data = (await response.json()) as {
        items?: Array<{
          id?: { videoId?: string };
          snippet?: {
            title?: string;
            channelTitle?: string;
            publishedAt?: string;
            description?: string;
            thumbnails?: {
              medium?: { url?: string };
              high?: { url?: string };
              default?: { url?: string };
            };
          };
        }>;
      };

      const items = Array.isArray(data.items) ? data.items : [];
      const results: YouTubeSearchResult[] = [];

      for (const item of items) {
        const videoId = item.id?.videoId?.trim();
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) continue;

        const snippet = item.snippet ?? {};
        const title = decodeHtmlEntities(snippet.title?.trim() || 'YouTube Videosu');
        const channelTitle = decodeHtmlEntities(snippet.channelTitle?.trim() || 'YouTube');
        const thumbnailUrl =
          snippet.thumbnails?.medium?.url ||
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.default?.url ||
          `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        results.push({
          videoId,
          title,
          channelTitle,
          publishedAt: snippet.publishedAt,
          thumbnailUrl,
          description: snippet.description ? decodeHtmlEntities(snippet.description) : undefined
        });
      }

      if (this.cache.size >= 100) {
        const oldestKey = this.cache.keys().next().value;
        if (oldestKey) this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, {
        expiresAt: now + this.ttlMs,
        results
      });

      return {
        ok: true,
        query,
        fallbackSearchUrl,
        results,
        cached: false
      };
    } catch {
      // Never log or expose url containing apiKey
      return {
        ok: false,
        query,
        fallbackSearchUrl,
        results: [],
        errorCode: 'UPSTREAM_ERROR',
        errorMessage: 'YouTube API sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edin.'
      };
    }
  }

  /**
   * Lists videos of a (public/unlisted) playlist via YouTube Data API playlistItems.list.
   */
  public async fetchPlaylistVideos(
    playlistId: string | null,
    forceRefresh = false
  ): Promise<{
    ok: boolean;
    results: YouTubeSearchResult[];
    cached?: boolean;
    errorCode?: 'NO_API_KEY' | 'NO_PLAYLIST' | 'UPSTREAM_ERROR';
    errorMessage?: string;
  }> {
    if (!this.apiKey) {
      return {
        ok: false,
        results: [],
        errorCode: 'NO_API_KEY',
        errorMessage: 'YOUTUBE_API_KEY tanımlanmamış.'
      };
    }
    if (!playlistId || !/^[a-zA-Z0-9_-]+$/.test(playlistId)) {
      return {
        ok: false,
        results: [],
        errorCode: 'NO_PLAYLIST',
        errorMessage: 'YOUTUBE_PLAYLIST_ID tanımlanmamış veya geçersiz.'
      };
    }

    const now = Date.now();
    const cached = this.playlistCache.get(playlistId);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return {
        ok: true,
        results: cached.results,
        cached: true
      };
    }

    const results: YouTubeSearchResult[] = [];
    let pageToken: string | undefined;

    try {
      for (let page = 0; page < 4; page++) {
        const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('maxResults', '50');
        url.searchParams.set('playlistId', playlistId);
        url.searchParams.set('key', this.apiKey);
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) {
          return {
            ok: false,
            results: [],
            errorCode: 'UPSTREAM_ERROR',
            errorMessage: `Oynatma listesi okunamadı (HTTP ${response.status}). Liste "Liste dışı" veya "Herkese açık" olmalı ve ID doğru olmalı.`
          };
        }

        const data = (await response.json()) as {
          nextPageToken?: string;
          items?: Array<{
            snippet?: {
              title?: string;
              videoOwnerChannelTitle?: string;
              publishedAt?: string;
              resourceId?: { videoId?: string };
              thumbnails?: {
                maxres?: { url?: string };
                standard?: { url?: string };
                high?: { url?: string };
                medium?: { url?: string };
                default?: { url?: string };
              };
            };
          }>;
        };

        for (const item of data.items ?? []) {
          const snippet = item.snippet;
          const videoId = snippet?.resourceId?.videoId?.trim();
          if (!snippet || !videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) continue;
          // Skip deleted/private placeholders
          if (snippet.title === 'Private video' || snippet.title === 'Deleted video') continue;
          results.push({
            videoId,
            title: decodeHtmlEntities(snippet.title?.trim() || 'YouTube Videosu'),
            channelTitle: decodeHtmlEntities(snippet.videoOwnerChannelTitle?.trim() || 'YouTube'),
            publishedAt: snippet.publishedAt,
            thumbnailUrl:
              snippet.thumbnails?.maxres?.url ||
              snippet.thumbnails?.standard?.url ||
              snippet.thumbnails?.high?.url ||
              snippet.thumbnails?.medium?.url ||
              snippet.thumbnails?.default?.url ||
              `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          });
        }

        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }

      this.playlistCache.set(playlistId, {
        expiresAt: now + this.playlistTtlMs,
        results
      });

      return { ok: true, results };
    } catch {
      return {
        ok: false,
        results: [],
        errorCode: 'UPSTREAM_ERROR',
        errorMessage: 'YouTube API sunucusuna ulaşılamadı.'
      };
    }
  }

  /**
   * Fetches video title and channel name via YouTube's public oEmbed endpoint (no API key required).
   */
  public async fetchVideoMetadata(
    videoId: string
  ): Promise<{ title: string; channelTitle: string } | null> {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`
    )}&format=json`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      const response = await this.fetchImpl(oembedUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) return null;
      const data = (await response.json()) as {
        title?: string;
        author_name?: string;
      };
      const title = data.title?.trim();
      const channelTitle = data.author_name?.trim();
      if (!title) return null;
      return {
        title,
        channelTitle: channelTitle || 'YouTube'
      };
    } catch {
      return null;
    }
  }
}
