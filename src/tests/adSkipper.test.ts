import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

interface AdSkipperHelpers {
  normalizeText: (raw: string) => string;
  isCountdownText: (raw: string) => boolean;
  isAdNoticeText: (raw: string) => boolean;
  isActionableSkipText: (raw: string, hasAdContext?: boolean) => boolean;
  isExternalLinkTrap: (el: unknown, currentHostname?: string) => boolean;
}

const extensionDir = resolve(process.cwd(), 'extension');

describe('Extension Pre-roll Ad Skipper', () => {
  let helpers: AdSkipperHelpers;

  beforeAll(() => {
    const source = readFileSync(resolve(extensionDir, 'adSkipper.js'), 'utf8');
    const sandbox: Record<string, unknown> = {
      URL,
      globalThis: {}
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox);
    helpers = sandbox.__TV_CONTROLLER_AD_SKIPPER_HELPERS__ as AdSkipperHelpers;
  });

  it('registers adSkipper.js cleanly in MV3 manifest.json with valid icons', () => {
    const manifest = JSON.parse(readFileSync(resolve(extensionDir, 'manifest.json'), 'utf8'));
    expect(manifest.manifest_version).toBe(3);

    const adScriptEntry = manifest.content_scripts.find(
      (entry: { js?: string[] }) => Array.isArray(entry.js) && entry.js.includes('adSkipper.js')
    );
    expect(adScriptEntry).toBeDefined();
    expect(adScriptEntry.all_frames).toBe(true);
    expect(adScriptEntry.exclude_matches).toContain('*://*.youtube.com/*');
    expect(adScriptEntry.exclude_matches).toContain('*://*.netflix.com/*');

    for (const iconPath of Object.values(manifest.icons as Record<string, string>)) {
      expect(existsSync(resolve(extensionDir, iconPath))).toBe(true);
    }

    // Strictly validate every Chrome Match Pattern in manifest.json
    // (Chrome rejects trailing wildcards in host like http://192.168.*/*)
    const isValidChromeMatchPattern = (pattern: string): boolean => {
      if (pattern === '<all_urls>') return true;
      const m = pattern.match(/^(\*|http|https|file|ftp):\/\/([^/]+)(\/.*)$/);
      if (!m) return false;
      const host = m[2];
      if (host === '*') return true;
      if (host.startsWith('*.')) {
        const rest = host.slice(2);
        return rest.length > 0 && !rest.includes('*');
      }
      return !host.includes('*');
    };

    const allMatchPatterns: string[] = [
      ...(manifest.host_permissions || []),
      ...(manifest.optional_host_permissions || []),
      ...manifest.content_scripts.flatMap((cs: { matches?: string[]; exclude_matches?: string[] }) => [
        ...(cs.matches || []),
        ...(cs.exclude_matches || [])
      ])
    ];

    for (const pattern of allMatchPatterns) {
      expect(isValidChromeMatchPattern(pattern), `Invalid Chrome match pattern: ${pattern}`).toBe(true);
    }
  });

  it('normalizes Turkish characters and strips decorative symbols', () => {
    expect(helpers.normalizeText('REKLAMI GEÇ »')).toBe('reklami gec');
    expect(helpers.normalizeText('  Reklamı Atla > ')).toBe('reklami atla');
    expect(helpers.normalizeText('Skip Ad ×')).toBe('skip ad');
  });

  it('recognizes actionable skip-ad labels in Turkish and English', () => {
    expect(helpers.isActionableSkipText('Reklamı Geç')).toBe(true);
    expect(helpers.isActionableSkipText('REKLAMI GEÇ »')).toBe(true);
    expect(helpers.isActionableSkipText('Reklamı Atla')).toBe(true);
    expect(helpers.isActionableSkipText('Reklamı Kapat')).toBe(true);
    expect(helpers.isActionableSkipText('Videoya Geç')).toBe(true);
    expect(helpers.isActionableSkipText('Skip Ad')).toBe(true);
    expect(helpers.isActionableSkipText('Skip Ads')).toBe(true);

    // Contextual short labels only match inside ad context
    expect(helpers.isActionableSkipText('Geç', false)).toBe(false);
    expect(helpers.isActionableSkipText('Geç', true)).toBe(true);
    expect(helpers.isActionableSkipText('Skip', false)).toBe(false);
    expect(helpers.isActionableSkipText('Skip', true)).toBe(true);
  });

  it('rejects 5-second countdown states until countdown finishes', () => {
    expect(helpers.isCountdownText('5 saniye sonra geçebilirsiniz')).toBe(true);
    expect(helpers.isCountdownText('Reklamı geç (4)')).toBe(true);
    expect(helpers.isCountdownText('Reklamı geçmek için 5 sn')).toBe(true);
    expect(helpers.isCountdownText('Skip in 3s')).toBe(true);
    expect(helpers.isCountdownText('Bekleyin...')).toBe(true);

    expect(helpers.isActionableSkipText('5 saniye sonra reklamı geç', true)).toBe(false);
    expect(helpers.isActionableSkipText('Reklamı Geç (3)', true)).toBe(false);
    expect(helpers.isActionableSkipText('Skip in 4s', true)).toBe(false);
  });

  it('detects countdown notices as active ad evidence', () => {
    expect(helpers.isAdNoticeText('Reklamı geçmek için 5 sn')).toBe(true);
    expect(helpers.isAdNoticeText('Skip ad in 4 seconds')).toBe(true);
    expect(helpers.isAdNoticeText('Reklamı Geç')).toBe(true);
    expect(helpers.isAdNoticeText('3. Sezon 4. Bölüm')).toBe(false);
  });

  it('never triggers on non-ad UI controls like intro or next episode buttons', () => {
    expect(helpers.isActionableSkipText('Sonraki Bölüm', true)).toBe(false);
    expect(helpers.isActionableSkipText('Özeti Geç', true)).toBe(false);
    expect(helpers.isActionableSkipText('Intro Geç', true)).toBe(false);
    expect(helpers.isActionableSkipText('Skip Intro', true)).toBe(false);
    expect(helpers.isActionableSkipText('Next Episode', true)).toBe(false);
  });

  it('blocks external ad-link traps while allowing safe anchor buttons', () => {
    const makeAnchorEl = (href: string) => ({
      closest: (sel: string) => (sel === 'a[href]' ? { getAttribute: () => href } : null)
    });

    expect(helpers.isExternalLinkTrap(makeAnchorEl('https://bet-site.example/promo'), 'vidmoly.to')).toBe(true);
    expect(helpers.isExternalLinkTrap(makeAnchorEl('https://vidmoly.to/watch/123'), 'vidmoly.to')).toBe(false);
    expect(helpers.isExternalLinkTrap(makeAnchorEl('#'), 'vidmoly.to')).toBe(false);
    expect(helpers.isExternalLinkTrap(makeAnchorEl('javascript:void(0)'), 'vidmoly.to')).toBe(false);
  });
});

describe('Extension Episode Playback Tracking (content.js)', () => {
  interface ContentHelpers {
    isShortAdOrPreviewVideo: (video: unknown) => boolean;
    getVideoMetrics: (video: unknown) => {
      hasVideo: boolean;
      isPlaying: boolean;
      currentTime: number;
      duration: number;
      isNearEnd: boolean;
      ended: boolean;
    };
  }

  let contentHelpers: ContentHelpers;

  beforeAll(() => {
    const source = readFileSync(resolve(extensionDir, 'content.js'), 'utf8');
    const sandbox: Record<string, unknown> = { globalThis: {} };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(source, sandbox);
    contentHelpers = sandbox.__TV_CONTROLLER_CONTENT_HELPERS__ as ContentHelpers;
  });

  it('ignores short pre-roll/mid-roll ad videos when computing episode completion', () => {
    const endedAdVideo = {
      isConnected: true,
      duration: 15,
      currentTime: 15,
      paused: true,
      ended: true,
      readyState: 4
    };
    expect(contentHelpers.isShortAdOrPreviewVideo(endedAdVideo)).toBe(true);
    const metrics = contentHelpers.getVideoMetrics(endedAdVideo);
    expect(metrics.hasVideo).toBe(false);
    expect(metrics.ended).toBe(false);
    expect(metrics.isNearEnd).toBe(false);
  });

  it('ignores detached/removed video elements even if ended is true', () => {
    const detachedVideo = {
      isConnected: false,
      duration: 3941,
      currentTime: 3941,
      paused: true,
      ended: true,
      readyState: 4
    };
    const metrics = contentHelpers.getVideoMetrics(detachedVideo);
    expect(metrics.hasVideo).toBe(false);
    expect(metrics.ended).toBe(false);
  });

  it('does not mark an in-progress episode (13:26 / 1:05:41) as ended or near-end', () => {
    const inProgress = {
      isConnected: true,
      duration: 3941,
      currentTime: 806,
      paused: false,
      ended: false,
      readyState: 4
    };
    const metrics = contentHelpers.getVideoMetrics(inProgress);
    expect(metrics.hasVideo).toBe(true);
    expect(metrics.isPlaying).toBe(true);
    expect(metrics.ended).toBe(false);
    expect(metrics.isNearEnd).toBe(false);
  });

  it('marks a real >=5 min episode as near-end / ended only at the actual end', () => {
    const nearEnd = {
      isConnected: true,
      duration: 3941,
      currentTime: 3860,
      paused: false,
      ended: false,
      readyState: 4
    };
    expect(contentHelpers.getVideoMetrics(nearEnd).isNearEnd).toBe(true);
    expect(contentHelpers.getVideoMetrics(nearEnd).ended).toBe(false);

    const finished = {
      isConnected: true,
      duration: 3941,
      currentTime: 3941,
      paused: true,
      ended: true,
      readyState: 4
    };
    expect(contentHelpers.getVideoMetrics(finished).ended).toBe(true);
  });
});
