import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { ShortcutItem } from '../shared/types.js';
import { DEFAULT_SHORTCUTS, parseCustomShortcuts } from '../shared/shortcuts.js';
import { getDefaultProgressFilePath, loadProgressAsShortcuts } from './progress.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveEnvFilePath(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

const envPath = resolveEnvFilePath();
dotenv.config(envPath ? { path: envPath } : undefined);

export interface AppConfig {
  port: number;
  host: string;
  allowLan: boolean;
  youtubeApiKey: string | null;
  youtubePlaylistId: string | null;
  progressToken: string | null;
  progressFilePath: string;
  shortcuts: ShortcutItem[];
  allowedShortcutIds: ReadonlySet<string>;
  lanIps: string[];
  lanRemoteUrls: string[];
  launchAntigravity: boolean;
  autoLaunchTv: boolean;
}

export function isPrivateLanIp(ip: string): boolean {
  if (!ip) return false;
  const clean = ip.trim().toLowerCase();
  if (clean === 'localhost') return true;
  if (clean.endsWith('.local')) return true;
  const normalized = clean.replace(/^::ffff:/i, '').split('%')[0];
  if (normalized === '127.0.0.1' || normalized === '::1') return true;
  if (normalized.startsWith('192.168.')) return true;
  if (normalized.startsWith('10.')) return true;
  if (normalized.startsWith('fe80:')) return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized) || normalized.startsWith('fc00:') || normalized.startsWith('fd00:')) {
    return true;
  }
  const parts = normalized.split('.').map(Number);
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }
  return false;
}

export function detectLanIpv4Addresses(): string[] {
  const nets = os.networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal && isPrivateLanIp(net.address)) {
        addresses.push(net.address);
      }
    }
  }

  // Prefer 192.168.x.x first as standard home Wi-Fi subnet
  return addresses.sort((a, b) => {
    const a192 = a.startsWith('192.168.') ? 0 : 1;
    const b192 = b.startsWith('192.168.') ? 0 : 1;
    return a192 - b192;
  });
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  customProgressFilePath?: string
): AppConfig {
  const rawPort = Number(env.PORT || '3000');
  const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 3000;

  const allowLanFlag =
    env.ALLOW_LAN?.toLowerCase() === 'true' ||
    env.ALLOW_LAN === '1' ||
    env.HOST === '0.0.0.0';

  let host = '127.0.0.1';
  if (allowLanFlag) {
    const customHost = env.HOST?.trim();
    if (customHost && (customHost === '0.0.0.0' || isPrivateLanIp(customHost))) {
      host = customHost;
    } else {
      host = '0.0.0.0';
    }
  }

  const rawApiKey = env.YOUTUBE_API_KEY?.trim() || '';
  const youtubeApiKey = rawApiKey.length > 0 ? rawApiKey : null;

  const rawProgressToken = env.PROGRESS_TOKEN?.trim() || '';
  const progressToken = rawProgressToken.length > 0 ? rawProgressToken : null;

  const progressFilePath =
    customProgressFilePath ??
    (env.VITEST === 'true'
      ? path.join(
          os.tmpdir(),
          `tv-progress-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`
        )
      : getDefaultProgressFilePath());

  const customShortcuts = parseCustomShortcuts(env.CUSTOM_SHORTCUTS_JSON);
  const diziProgressShortcuts = loadProgressAsShortcuts(progressFilePath);

  // Merge shortcuts without duplicate IDs
  const shortcutMap = new Map<string, ShortcutItem>();
  for (const item of [...DEFAULT_SHORTCUTS, ...customShortcuts, ...diziProgressShortcuts]) {
    shortcutMap.set(item.id, item);
  }
  const shortcuts = Array.from(shortcutMap.values());
  const allowedShortcutIds = new Set(shortcuts.map((s) => s.id));

  const lanIps = detectLanIpv4Addresses();
  const lanRemoteUrls = lanIps.map((ip) => `http://${ip}:${port}/remote`);

  const launchAntigravity =
    env.LAUNCH_ANTIGRAVITY?.toLowerCase() === 'true' ||
    env.LAUNCH_ANTIGRAVITY === '1';

  const autoLaunchTv =
    env.AUTO_LAUNCH_TV?.toLowerCase() === 'true' ||
    env.AUTO_LAUNCH_TV === '1';

  return {
    port,
    host,
    allowLan: host !== '127.0.0.1',
    youtubeApiKey,
    youtubePlaylistId: env.YOUTUBE_PLAYLIST_ID?.trim() || null,
    progressToken,
    progressFilePath,
    shortcuts,
    allowedShortcutIds,
    lanIps,
    lanRemoteUrls,
    launchAntigravity,
    autoLaunchTv
  };
}
