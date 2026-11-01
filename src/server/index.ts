import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { loadConfig, isPrivateLanIp, type AppConfig } from './config.js';
import { YouTubeSearchService } from './youtube.js';
import { WsHub } from './wsHub.js';
import { extractYouTubeVideoId, sanitizeText } from '../shared/protocol.js';
import { isSafeHttpsUrl } from '../shared/shortcuts.js';
import {
  advanceProgressEpisode,
  deleteProgress,
  importFromChromeBookmarks,
  loadProgress,
  upsertProgress
} from './progress.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface RunningServer {
  app: express.Express;
  httpServer: http.Server;
  wsHub: WsHub;
  config: AppConfig;
  port: number;
  close: () => Promise<void>;
}

export async function createServer(
  customConfig?: Partial<AppConfig>,
  options?: { isProduction?: boolean; fetchImpl?: typeof fetch }
): Promise<RunningServer> {
  const baseConfig = loadConfig(process.env, customConfig?.progressFilePath);
  const config: AppConfig = {
    ...baseConfig,
    ...customConfig
  };

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(express.text({ limit: '16kb' }));
  app.use((req, _res, next) => {
    const time = new Date().toLocaleTimeString('tr-TR');
    console.log(`[${time}] ${req.method} ${req.originalUrl || req.url}`);
    next();
  });

  const youtubeService = new YouTubeSearchService({
    apiKey: config.youtubeApiKey,
    fetchImpl: options?.fetchImpl
  });

  const httpServer = http.createServer(app);
  const wsHub = new WsHub(httpServer, {
    shortcuts: config.shortcuts,
    allowedShortcutIds: config.allowedShortcutIds,
    youtubeApiConfigured: youtubeService.isConfigured(),
    lanUrls: config.lanRemoteUrls,
    progressFilePath: config.progressFilePath,
    port: config.port,
    launchAntigravity: config.launchAntigravity,
    autoLaunchTv: config.autoLaunchTv
  });

  function extractRawShareCandidate(req: express.Request): string {
    const candidates: string[] = [];

    // 1. Check raw query tail in originalUrl (handles unencoded YouTube URLs with &v=... in iOS Shortcuts)
    const rawQueryIndex = req.originalUrl.indexOf('?');
    if (rawQueryIndex !== -1) {
      const rawQuery = req.originalUrl.slice(rawQueryIndex + 1);
      const prefixMatch = rawQuery.match(/^(?:url|play|text|q)=([\s\S]+)$/i);
      if (prefixMatch?.[1]) {
        try {
          candidates.push(decodeURIComponent(prefixMatch[1]).trim());
        } catch {
          candidates.push(prefixMatch[1].trim());
        }
      }
    }

    // 2. Standard parsed query parameters
    const queryCandidates = [
      req.query.url,
      req.query.play,
      req.query.v,
      req.query.videoId,
      req.query.text,
      req.query.q
    ];
    for (const c of queryCandidates) {
      if (typeof c === 'string' && c.trim()) {
        candidates.push(c.trim());
      }
    }

    // 3. Request body (plain text, JSON, or form-urlencoded)
    if (typeof req.body === 'string' && req.body.trim()) {
      candidates.push(req.body.trim());
    } else if (req.body && typeof req.body === 'object') {
      const bodyObj = req.body as Record<string, unknown>;
      const bodyCandidates = [
        bodyObj.url,
        bodyObj.play,
        bodyObj.v,
        bodyObj.videoId,
        bodyObj.text,
        bodyObj.q
      ];
      for (const c of bodyCandidates) {
        if (typeof c === 'string' && c.trim()) {
          candidates.push(c.trim());
        }
      }
    }

    // Prefer the first candidate that yields a valid YouTube video ID
    for (const candidate of candidates) {
      if (extractYouTubeVideoId(candidate)) {
        return candidate;
      }
    }

    return candidates[0] ?? '';
  }

  function triggerInstantYouTubePlay(
    rawInput: string,
    options?: { customTitle?: string; openExternalTab?: boolean }
  ): { ok: true; videoId: string; title: string; channelTitle: string } | { ok: false; error: string } {
    const videoId = extractYouTubeVideoId(rawInput);
    if (!videoId) {
      return {
        ok: false,
        error: 'Geçerli bir YouTube video bağlantısı veya 11 karakterlik video kimliği bulunamadı.'
      };
    }

    const title = sanitizeText(options?.customTitle, 160, `YouTube Video (${videoId})`);
    const channelTitle = 'iPhone Doğrudan Paylaşım';
    const openInNewYouTubeTab = options?.openExternalTab ?? true;

    if (openInNewYouTubeTab) {
      wsHub.executeCommand({
        type: 'OPEN_YOUTUBE_EXTERNAL',
        target: 'video',
        queryOrVideoId: videoId
      });
    } else {
      wsHub.executeCommand({
        type: 'PLAY_VIDEO',
        videoId,
        title,
        channelTitle,
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
      });

      if (!options?.customTitle) {
        void youtubeService.fetchVideoMetadata(videoId).then((meta) => {
          if (meta) {
            wsHub.updateNowPlayingMetadata(videoId, meta.title, meta.channelTitle);
          }
        });
      }
    }

    return { ok: true, videoId, title, channelTitle };
  }

  // Health & system info endpoint
  app.get('/api/health', async (_req, res) => {
    const primaryRemoteUrl =
      config.lanRemoteUrls[0] ?? `http://localhost:${config.port}/remote`;

    let qrCodeDataUrl: string | null = null;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(primaryRemoteUrl, {
        margin: 1,
        width: 240,
        color: {
          dark: '#1e232a',
          light: '#ffffff'
        }
      });
    } catch {
      qrCodeDataUrl = null;
    }

    res.json({
      ok: true,
      port: config.port,
      allowLan: config.allowLan,
      youtubeApiConfigured: youtubeService.isConfigured(),
      lanIps: config.lanIps,
      lanRemoteUrls: config.lanRemoteUrls,
      primaryRemoteUrl,
      qrCodeDataUrl,
      state: wsHub.getState()
    });
  });

  // One-step direct YouTube share/play endpoint (works with iOS Shortcuts GET/POST or direct links)
  const handleDirectPlayRequest: express.RequestHandler = (req, res) => {
    const rawCandidate = extractRawShareCandidate(req);

    // If user tapped the Play/Test button inside iOS Shortcuts editor without sharing a link, return 200 OK
    if (!rawCandidate) {
      res.json({
        ok: true,
        testMode: true,
        message:
          "Sunucu bağlantısı başarılı! YouTube uygulamasından Paylaş -> TV'de Oynat dediğinizde video TV'de açılacak."
      });
      return;
    }

    const customTitle =
      typeof req.query.title === 'string'
        ? req.query.title
        : req.body && typeof req.body === 'object' && typeof (req.body as Record<string, unknown>).title === 'string'
          ? ((req.body as Record<string, unknown>).title as string)
          : undefined;
    const modeParam =
      typeof req.query.mode === 'string'
        ? req.query.mode
        : typeof req.query.tab === 'string'
          ? req.query.tab
          : '';
    const openExternalTab = modeParam !== 'embed' && modeParam !== '0';

    const result = triggerInstantYouTubePlay(rawCandidate, {
      customTitle,
      openExternalTab
    });

    if (!result.ok) {
      res.status(400).json({
        ok: false,
        errorCode: 'INVALID_VIDEO_URL',
        errorMessage: result.error
      });
      return;
    }

    res.json({
      ok: true,
      videoId: result.videoId,
      title: result.title,
      channelTitle: result.channelTitle,
      tvConnectedCount: wsHub.getState().tvConnectedCount
    });
  };

  app.get('/api/youtube/play', handleDirectPlayRequest);
  app.post('/api/youtube/play', handleDirectPlayRequest);
  app.get('/api/play', handleDirectPlayRequest);
  app.post('/api/play', handleDirectPlayRequest);

  // Browser redirect shortcut: /play?url=<youtube-url> triggers TV playback immediately and opens /remote
  app.get('/play', (req, res) => {
    void wsHub.ensureDesktopAppsRunning();
    const rawCandidate = extractRawShareCandidate(req);
    if (rawCandidate) {
      triggerInstantYouTubePlay(rawCandidate);
    }
    res.redirect(302, '/remote');
  });

  // Auto-redirect mobile devices (iPhone/iPad/Android) visiting root / to /remote
  app.get('/', (req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';
    const isMobile = /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent);
    if (isMobile) {
      res.redirect(302, '/remote');
      return;
    }
    next();
  });

  // Handle direct video playback or auto-launch TV when remote is opened
  app.use((req, _res, next) => {
    if (req.method === 'GET') {
      const p = req.path.toLowerCase();
      if (p.startsWith('/remote') || p === '/' || p === '') {
        const rawCandidate = extractRawShareCandidate(req);
        if (rawCandidate) {
          void wsHub.ensureDesktopAppsRunning({ forceTv: true });
          triggerInstantYouTubePlay(rawCandidate);
        } else if (config.autoLaunchTv && wsHub.getState().tvConnectedCount === 0) {
          void wsHub.ensureDesktopAppsRunning();
        }
      }
    }
    next();
  });

  // Desktop launch / wake endpoints (for iOS Shortcuts, webhooks, or remote app)
  app.all('/api/wake', async (_req, res) => {
    const result = await wsHub.ensureDesktopAppsRunning({ forceTv: true });
    res.json(result);
  });

  app.all('/api/launch-tv', async (_req, res) => {
    const result = await wsHub.ensureDesktopAppsRunning({ forceTv: true });
    res.json(result);
  });

  app.all('/api/launch-all', async (_req, res) => {
    const result = await wsHub.ensureDesktopAppsRunning({ forceTv: true, forceAntigravity: true });
    res.json(result);
  });

  app.all('/api/launch-antigravity', async (_req, res) => {
    const result = await wsHub.ensureDesktopAppsRunning({ forceAntigravity: true });
    res.json(result);
  });

  // Automatic TV series artwork resolver (caches TVMaze 16:9 background/poster URLs with max 100 entries)
  const posterCache = new Map<string, string>();
  const MAX_POSTER_CACHE_SIZE = 100;
  function setPosterCache(key: string, url: string): void {
    if (posterCache.size >= MAX_POSTER_CACHE_SIZE) {
      const oldestKey = posterCache.keys().next().value;
      if (oldestKey) posterCache.delete(oldestKey);
    }
    posterCache.set(key, url);
  }

  app.get('/api/series-poster', async (req, res) => {
    const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    const cacheKey = rawQuery.toLowerCase();

    if (cacheKey && posterCache.has(cacheKey)) {
      res.redirect(302, posterCache.get(cacheKey)!);
      return;
    }

    if (rawQuery) {
      try {
        const fetchFn = options?.fetchImpl ?? fetch;
        const tvMazeRes = await fetchFn(
          `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(rawQuery)}&embed=images`
        );
        if (tvMazeRes.ok) {
          const data = (await tvMazeRes.json()) as {
            image?: { original?: string; medium?: string };
            _embedded?: {
              images?: Array<{
                type?: string;
                resolutions?: { original?: { url?: string } };
              }>;
            };
          };
          const bgUrl = data._embedded?.images?.find((img) => img.type === 'background')
            ?.resolutions?.original?.url;
          const resolvedUrl = bgUrl ?? data.image?.original ?? data.image?.medium;
          if (resolvedUrl && resolvedUrl.startsWith('https://')) {
            setPosterCache(cacheKey, resolvedUrl);
            res.redirect(302, resolvedUrl);
            return;
          }
        }
      } catch {
        // Fallback to clean SVG card below
      }
    }

    const safeLabel = sanitizeText(rawQuery, 28, 'Dizi').replace(/[<>&"']/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#2c3e50"/>
          <stop offset="100%" stop-color="#3b6b82"/>
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="url(#g)"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#f3f1ec" font-family="sans-serif" font-size="34" font-weight="600">${safeLabel}</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(svg);
  });

  // Rate limiter for YouTube search endpoint: max 25 requests per minute per IP to protect quota
  const searchRateLimiter = new Map<string, { count: number; resetAt: number }>();
  function checkSearchRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = searchRateLimiter.get(ip);
    if (!entry || entry.resetAt <= now) {
      searchRateLimiter.set(ip, { count: 1, resetAt: now + 60000 });
      return true;
    }
    if (entry.count >= 25) {
      return false;
    }
    entry.count += 1;
    return true;
  }

  // YouTube search proxy endpoint (keeps YOUTUBE_API_KEY on backend only)
  app.get('/api/youtube/search', async (req, res) => {
    const clientIp = req.socket.remoteAddress || req.ip || '127.0.0.1';
    if (!checkSearchRateLimit(clientIp)) {
      res.status(429).json({
        ok: false,
        query: typeof req.query.q === 'string' ? req.query.q : '',
        fallbackSearchUrl: 'https://www.youtube.com',
        results: [],
        errorCode: 'QUOTA_EXCEEDED',
        errorMessage: 'Çok fazla arama isteği yapıldı. Lütfen 1 dakika bekleyin.'
      });
      return;
    }
    const q = req.query.q;
    const result = await youtubeService.searchVideos(q);
    const statusCode =
      result.ok
        ? 200
        : result.errorCode === 'INVALID_QUERY'
          ? 400
          : result.errorCode === 'NO_API_KEY'
            ? 503
            : result.errorCode === 'QUOTA_EXCEEDED'
              ? 429
              : 502;
    res.status(statusCode).json(result);
  });

  // "Sonra İzle" playlist (YOUTUBE_PLAYLIST_ID) proxy
  app.get('/api/youtube/playlist', async (req, res) => {
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const result = await youtubeService.fetchPlaylistVideos(config.youtubePlaylistId, forceRefresh);
    if (!result.ok) {
      res
        .status(result.errorCode === 'UPSTREAM_ERROR' ? 502 : 503)
        .json(result);
      return;
    }

    const deletedIds = wsHub.getDeletedWatchLaterVideoIds();
    const deletedSet = new Set(deletedIds);
    const visibleResults = result.results.filter((v) => !deletedSet.has(v.videoId));
    const removedResults = result.results.filter((v) => deletedSet.has(v.videoId));

    res.json({
      ...result,
      results: visibleResults,
      removedResults,
      allResults: result.results,
      deletedVideoIds: deletedIds,
      playlistId: config.youtubePlaylistId
    });
  });

  app.post('/api/youtube/playlist/remove', (req, res) => {
    const videoId = typeof req.body?.videoId === 'string' ? req.body.videoId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      res.status(400).json({ ok: false, errorMessage: 'Geçersiz video ID.' });
      return;
    }
    wsHub.removeWatchLaterVideo(videoId);
    res.json({ ok: true, deletedVideoIds: wsHub.getDeletedWatchLaterVideoIds() });
  });

  app.post('/api/youtube/playlist/restore', (req, res) => {
    const videoId = typeof req.body?.videoId === 'string' ? req.body.videoId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      res.status(400).json({ ok: false, errorMessage: 'Geçersiz video ID.' });
      return;
    }
    wsHub.restoreWatchLaterVideo(videoId);
    res.json({ ok: true, deletedVideoIds: wsHub.getDeletedWatchLaterVideoIds() });
  });

  app.post('/api/youtube/playlist/clear-removed', (_req, res) => {
    wsHub.clearRemovedWatchLaterVideos();
    res.json({ ok: true, deletedVideoIds: [] });
  });

  // Secure CORS middleware for progress endpoints (enables Chrome Extension and authorized local LAN calls)
  app.use('/api/progress', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const u = new URL(origin);
        const host = u.hostname.toLowerCase();
        const isExtension = origin.startsWith('chrome-extension://');
        const isLocalOrLan =
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '::1' ||
          isPrivateLanIp(host);

        if (isExtension || isLocalOrLan) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Progress-Token, Authorization');
        }
      } catch {
        // Ignore malformed origin
      }
    } else {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Progress-Token, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  function verifyProgressRequest(req: express.Request, res: express.Response): boolean {
    const remoteIp = req.socket.remoteAddress || req.ip || '127.0.0.1';
    if (!isPrivateLanIp(remoteIp)) {
      res.status(403).json({
        ok: false,
        errorCode: 'FORBIDDEN_IP',
        errorMessage: 'Yalnızca yerel ağdan (LAN) erişime izin verilir.'
      });
      return false;
    }

    if (config.progressToken) {
      const headerToken = req.headers['x-progress-token'];
      const authHeader = req.headers.authorization;
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
      const bodyToken =
        req.body && typeof req.body === 'object' && typeof (req.body as Record<string, unknown>).token === 'string'
          ? ((req.body as Record<string, unknown>).token as string)
          : null;

      const suppliedToken = headerToken || bearerToken || queryToken || bodyToken;
      if (suppliedToken !== config.progressToken) {
        res.status(401).json({
          ok: false,
          errorCode: 'UNAUTHORIZED',
          errorMessage: 'Geçersiz veya eksik PROGRESS_TOKEN.'
        });
        return false;
      }
    }

    return true;
  }

  // GET /api/progress - List all tracked series progress entries
  app.get('/api/progress', (req, res) => {
    if (!verifyProgressRequest(req, res)) return;
    const entries = loadProgress(config.progressFilePath);
    res.json({
      ok: true,
      entries,
      activeTabCandidate: wsHub.getState().activeTabCandidate ?? null
    });
  });

  // POST /api/progress - Save/upsert episode progress from Chrome extension or remote
  app.post('/api/progress', (req, res) => {
    if (!verifyProgressRequest(req, res)) return;

    const rawUrl =
      typeof req.body?.url === 'string'
        ? req.body.url.trim()
        : typeof req.query.url === 'string'
          ? req.query.url.trim()
          : '';

    if (!isSafeHttpsUrl(rawUrl)) {
      res.status(400).json({
        ok: false,
        errorCode: 'INVALID_URL',
        errorMessage: 'Geçerli bir https:// adresi girilmelidir.'
      });
      return;
    }

    const rawTitle =
      typeof req.body?.title === 'string'
        ? req.body.title.trim()
        : typeof req.query.title === 'string'
          ? req.query.title.trim()
          : '';

    const rawSeason =
      typeof req.body?.season === 'number'
        ? req.body.season
        : typeof req.query.season === 'string'
          ? Number(req.query.season)
          : undefined;

    const rawEpisode =
      typeof req.body?.episode === 'number'
        ? req.body.episode
        : typeof req.query.episode === 'string'
          ? Number(req.query.episode)
          : undefined;

    try {
      const entry = upsertProgress(
        {
          url: rawUrl,
          title: rawTitle || undefined,
          season: Number.isInteger(rawSeason) && (rawSeason ?? 0) > 0 ? rawSeason : undefined,
          episode: Number.isInteger(rawEpisode) && (rawEpisode ?? 0) > 0 ? rawEpisode : undefined
        },
        config.progressFilePath
      );

      const entries = wsHub.syncProgressFromDisk(true);
      wsHub.setActiveTabCandidate(rawUrl, rawTitle || entry.title);

      res.json({
        ok: true,
        entry,
        entries
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        errorCode: 'SAVE_FAILED',
        errorMessage: err instanceof Error ? err.message : 'Kayıt başarısız.'
      });
    }
  });

  // POST /api/progress/active-tab - Extension reports active tab for instant remote save button
  app.post('/api/progress/active-tab', (req, res) => {
    if (!verifyProgressRequest(req, res)) return;

    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!isSafeHttpsUrl(rawUrl)) {
      res.status(400).json({
        ok: false,
        errorCode: 'INVALID_URL',
        errorMessage: 'Geçerli bir https:// adresi girilmelidir.'
      });
      return;
    }

    const rawTitle = typeof req.body?.title === 'string' ? sanitizeText(req.body.title, 160, '') : '';
    wsHub.setActiveTabCandidate(rawUrl, rawTitle);

    res.json({
      ok: true,
      activeTabCandidate: wsHub.getState().activeTabCandidate
    });
  });

  // POST /api/progress/:key/advance - Next episode button (+1)
  app.post('/api/progress/:key/advance', (req, res) => {
    if (!verifyProgressRequest(req, res)) return;

    const updated = advanceProgressEpisode(req.params.key, config.progressFilePath);
    if (!updated) {
      res.status(404).json({
        ok: false,
        errorCode: 'NOT_FOUND',
        errorMessage: 'Belirtilen dizi bulunamadı.'
      });
      return;
    }

    const entries = wsHub.syncProgressFromDisk(true);
    res.json({
      ok: true,
      entry: updated,
      entries
    });
  });

  // DELETE /api/progress/:key - Remove a tracked series
  app.delete('/api/progress/:key', (req, res) => {
    if (!verifyProgressRequest(req, res)) return;

    const deleted = deleteProgress(req.params.key, config.progressFilePath);
    const entries = wsHub.syncProgressFromDisk(true);

    res.json({
      ok: true,
      deleted,
      entries
    });
  });

  // POST /api/progress/import - Re-trigger one-time Chrome bookmark import
  app.post('/api/progress/import', (req, res) => {
    if (!verifyProgressRequest(req, res)) return;

    const entries = importFromChromeBookmarks(config.progressFilePath);
    wsHub.syncProgressFromDisk(true);

    res.json({
      ok: true,
      importedCount: entries.length,
      entries
    });
  });

  function resolveClientDistPath(): string {
    const candidates = [
      path.resolve(process.cwd(), 'dist/client'),
      path.resolve(__dirname, '../../client'),
      path.resolve(__dirname, '../../../dist/client')
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'index.html'))) return c;
    }
    return path.resolve(process.cwd(), 'dist/client');
  }

  const clientDist = resolveClientDistPath();
  const isProd =
    options?.isProduction ??
    (process.env.NODE_ENV === 'production' ||
      __dirname.includes('dist') ||
      (!fs.existsSync(path.resolve(process.cwd(), 'src/client/main.tsx')) &&
        fs.existsSync(path.join(clientDist, 'index.html'))));

  if (!isProd && process.env.VITEST !== 'true') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else if (isProd) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/api/') ||
        req.path.startsWith('/ws') ||
        req.path.startsWith('/assets/')
      ) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      const address = httpServer.address();
      const actualPort =
        typeof address === 'object' && address ? address.port : config.port;

      resolve({
        app,
        httpServer,
        wsHub,
        config,
        port: actualPort,
        close: async () => {
          await wsHub.close();
          await new Promise<void>((resClose) => httpServer.close(() => resClose()));
        }
      });
    });
  });
}

// Start server if invoked directly
const isMain =
  process.env.VITEST !== 'true' &&
  Boolean(process.argv[1]) &&
  (path.resolve(process.argv[1]).toLowerCase() === path.resolve(__filename).toLowerCase() ||
    process.argv[1].replace(/\\/g, '/').endsWith('/index.js') ||
    process.argv[1].replace(/\\/g, '/').endsWith('/index.ts'));

if (isMain) {
  process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught Exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled Rejection:', reason);
  });

  createServer()
    .then((srv) => {
      console.log('\n============================================================');
      console.log('  📺 SMART TV LAUNCHER & iPHONE REMOTE SERVER HAZIR');
      console.log('============================================================');
      console.log(`  🖥️  TV Arayüzü (Windows PC): http://localhost:${srv.port}/tv`);
      if (srv.config.allowLan && srv.config.lanRemoteUrls.length > 0) {
        console.log('  📱 iPhone Kumanda (Safari):');
        for (const url of srv.config.lanRemoteUrls) {
          console.log(`     👉 ${url}`);
        }
      } else {
        console.log(`  📱 Kumanda (Localhost):      http://localhost:${srv.port}/remote`);
        console.log('  ⚠️  Not: LAN erişimi için .env içinde ALLOW_LAN=true ayarlayın.');
      }
      console.log(
        `  🔑 YouTube Data API v3:      ${
          srv.config.youtubeApiKey
            ? 'Aktif (Uygulama içi arama hazır)'
            : 'Tanımlanmamış (Doğrudan link + TV tarayıcı arama yedeği aktif)'
        }`
      );
      console.log('============================================================\n');
    })
    .catch((err) => {
      console.error('Sunucu başlatılamadı:', err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
