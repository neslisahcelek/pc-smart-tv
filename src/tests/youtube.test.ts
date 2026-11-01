import { describe, expect, it, vi } from 'vitest';
import { YouTubeSearchService } from '../server/youtube.js';

describe('YouTubeSearchService', () => {
  it('returns NO_API_KEY and a valid TV browser fallback URL when no API key is configured', async () => {
    const service = new YouTubeSearchService({ apiKey: null });
    expect(service.isConfigured()).toBe(false);

    const res = await service.searchVideos('tarkan konser');
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('NO_API_KEY');
    expect(res.fallbackSearchUrl).toBe(
      'https://www.youtube.com/results?search_query=tarkan%20konser'
    );
  });

  it('fetches, parses, decodes HTML entities, and caches results when API key is configured', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: { videoId: 'dQw4w9WgXcQ' },
            snippet: {
              title: 'Seinfeld &amp; Friends &#39;Best&#39; Moments',
              channelTitle: 'Comedy Classics',
              thumbnails: {
                medium: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' }
              }
            }
          }
        ]
      })
    });

    const service = new YouTubeSearchService({
      apiKey: 'TEST_SECRET_API_KEY',
      fetchImpl: mockFetch as unknown as typeof fetch
    });

    const first = await service.searchVideos('seinfeld');
    expect(first.ok).toBe(true);
    expect(first.cached).toBe(false);
    expect(first.results).toHaveLength(1);
    expect(first.results[0].videoId).toBe('dQw4w9WgXcQ');
    expect(first.results[0].title).toBe("Seinfeld & Friends 'Best' Moments");

    // Second identical search should hit cache without calling fetch again
    const second = await service.searchVideos('SEINFELD');
    expect(second.ok).toBe(true);
    expect(second.cached).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles quotaExceeded errors gracefully without leaking the API key', async () => {
    const secretKey = 'SUPER_SECRET_KEY_12345';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          errors: [{ reason: 'quotaExceeded' }]
        }
      })
    });

    const service = new YouTubeSearchService({
      apiKey: secretKey,
      fetchImpl: mockFetch as unknown as typeof fetch
    });

    const res = await service.searchVideos('matrix trailer');
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('QUOTA_EXCEEDED');
    expect(JSON.stringify(res)).not.toContain(secretKey);
  });
});
