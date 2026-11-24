import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { clampInteger, sanitizeText } from '../shared/protocol.js';
import type {
  FavoriteTvChannel,
  VestelKeyName,
  VestelProtocolVariant,
  VestelTvStatus
} from '../shared/types.js';
import { detectLanIpv4Addresses, isPrivateLanIp } from './config.js';

export const VESTEL_DIAL_PORT = 56789;
export const VESTEL_DIAL_PORTS = [56789, 56790, 56791] as const;
export const VESTEL_RAW_TCP_PORT = 4660;
const SSDP_MULTICAST_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const REQUEST_TIMEOUT_MS = 2500;
const DEFAULT_KEEP_AWAKE_MINUTES = 45;

/**
 * Standard Vestel MB-series SmartCenter / RC5+1000 virtual remote key codes.
 */
export const VESTEL_KEY_CODE_MAP: Record<VestelKeyName, number> = {
  NUM_0: 1000,
  NUM_1: 1001,
  NUM_2: 1002,
  NUM_3: 1003,
  NUM_4: 1004,
  NUM_5: 1005,
  NUM_6: 1006,
  NUM_7: 1007,
  NUM_8: 1008,
  NUM_9: 1009,
  BACK: 1010,
  POWER: 1012,
  MUTE: 1013,
  VOL_UP: 1016,
  VOL_DOWN: 1017,
  INFO: 1018,
  LEFT: 1019,
  UP: 1020,
  DOWN: 1021,
  RIGHT: 1022,
  CH_UP: 1032,
  CH_DOWN: 1033,
  EXIT: 1037,
  TV_DTV: 1044,
  MENU: 1048,
  YELLOW: 1050,
  BLUE: 1052,
  OK: 1053,
  GREEN: 1054,
  RED: 1055,
  SOURCE: 1056
};

const VESTEL_BRAND_HINT_REGEX =
  /vestel|smart\s*center|toshiba|hitachi|telefunken|jvc|regal|finlux|techwood|seg|mb\d{2,3}/i;

interface PersistedVestelTvConfig {
  configuredHost?: string | null;
  protocolVariant?: VestelProtocolVariant;
  keepAwakeEnabled?: boolean;
  keepAwakeIntervalMinutes?: number;
  favoriteChannels?: FavoriteTvChannel[];
  lastVolume?: number;
}

export interface VestelTvControllerOptions {
  configFilePath?: string | null;
  initialHost?: string | null;
  initialKeepAwake?: boolean;
  onStateChange?: (status: VestelTvStatus) => void;
  fetchImpl?: typeof fetch;
  discoverImpl?: () => Promise<string | null>;
  tcpSenderImpl?: (host: string, code: number) => Promise<boolean>;
  delayImpl?: (ms: number) => Promise<void>;
}

export function getDefaultVestelConfigFilePath(): string {
  return path.resolve(process.cwd(), 'data', 'vestel-tv.json');
}

export function isSafeLocalTvHost(host: string | null | undefined): host is string {
  if (typeof host !== 'string') return false;
  const clean = host.trim().toLowerCase();
  if (!clean || clean.length > 100) return false;
  // Block link-local cloud metadata and loopback spoofing targets
  if (clean.startsWith('169.254.')) return false;
  if (clean === 'localhost' || clean === '127.0.0.1' || clean === '::1') return false;
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(clean);
  if (isIpv4) {
    const octets = clean.split('.').map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
    return isPrivateLanIp(clean);
  }
  return /^[a-z0-9-]{1,63}\.local$/.test(clean) && isPrivateLanIp(clean);
}

function buildRemoteKeyXml(code: number): string {
  return `<?xml version="1.0" encoding="utf-8"?><remote><key code="${code}"/></remote>`;
}

const UPNP_RENDERING_SERVICE = 'urn:schemas-upnp-org:service:RenderingControl:1';
const UPNP_DESC_PATHS = [
  { port: 2870, path: '/dmr.xml' },
  { port: 56789, path: '/dd.xml' },
  { port: 49152, path: '/description.xml' }
] as const;
const UPNP_CONTROL_CANDIDATES = [
  { port: 2870, path: '/upnp/control/RenderingControl' },
  { port: 56789, path: '/upnp/control/RenderingControl' },
  { port: 56789, path: '/upnp/control/RenderingControl1' },
  { port: 49152, path: '/ctl/RenderingControl' }
] as const;

function buildUpnpGetVolumeBody(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetVolume xmlns:u="${UPNP_RENDERING_SERVICE}">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetVolume>
  </s:Body>
</s:Envelope>`;
}

function buildUpnpSetVolumeBody(volume: number): string {
  const clean = clampInteger(volume, 0, 100);
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetVolume xmlns:u="${UPNP_RENDERING_SERVICE}">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>${clean}</DesiredVolume>
    </u:SetVolume>
  </s:Body>
</s:Envelope>`;
}

function buildUpnpGetMuteBody(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetMute xmlns:u="${UPNP_RENDERING_SERVICE}">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
    </u:GetMute>
  </s:Body>
</s:Envelope>`;
}

function parseUpnpCurrentVolume(xml: string): number | null {
  const match = xml.match(/<(?:[\w-]+:)?CurrentVolume>\s*(\d{1,3})\s*<\/(?:[\w-]+:)?CurrentVolume>/i);
  if (!match) return null;
  return clampInteger(Number(match[1]), 0, 100);
}

function parseUpnpCurrentMute(xml: string): boolean | null {
  const match = xml.match(/<(?:[\w-]+:)?CurrentMute>\s*(0|1|true|false)\s*<\/(?:[\w-]+:)?CurrentMute>/i);
  if (!match) return null;
  const val = match[1].toLowerCase();
  return val === '1' || val === 'true';
}

function extractRenderingControlUrl(xml: string, baseUrl: string): string | null {
  const serviceMatches = xml.matchAll(/<service\b[^>]*>([\s\S]*?)<\/service>/gi);
  for (const m of serviceMatches) {
    const block = m[1];
    if (!/RenderingControl/i.test(block)) continue;
    const ctrlMatch = block.match(/<controlURL>\s*([^<\s]+)\s*<\/controlURL>/i);
    if (!ctrlMatch) continue;
    try {
      const resolved = new URL(ctrlMatch[1], baseUrl);
      const base = new URL(baseUrl);
      if (resolved.hostname === base.hostname && resolved.protocol === 'http:') {
        return resolved.toString();
      }
    } catch {
      // ignore invalid URL
    }
  }
  return null;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkTcpPortOpen(host: string, port: number, timeoutMs = 350): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host, () => finish(true));
  });
}

async function sendRawTcpCommand(host: string, code: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(REQUEST_TIMEOUT_MS);
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(VESTEL_RAW_TCP_PORT, host, () => {
      socket.end(`${code}\r\n`, 'utf8', () => {
        setTimeout(() => finish(true), 50);
      });
    });
  });
}

export class VestelTvController {
  private readonly configFilePath: string | null;
  private readonly onStateChange?: (status: VestelTvStatus) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly discoverImpl?: () => Promise<string | null>;
  private readonly tcpSenderImpl: (host: string, code: number) => Promise<boolean>;
  private readonly delayImpl: (ms: number) => Promise<void>;

  private configuredHost: string | null = null;
  private discoveredHost: string | null = null;
  private connected = false;
  private discovering = false;
  private protocolVariant: VestelProtocolVariant = 'auto';
  private detectedVariant: Exclude<VestelProtocolVariant, 'auto'> | null = null;
  private detectedPort: number | null = null;
  private keepAwakeEnabled = false;
  private keepAwakeIntervalMinutes = DEFAULT_KEEP_AWAKE_MINUTES;
  private lastKeepAwakeAt: number | null = null;
  private lastError: string | null = null;
  private favoriteChannels: FavoriteTvChannel[] = [];
  private keepAwakeTimer: NodeJS.Timeout | null = null;
  private tvVolume = 20;
  private tvMuted = false;
  private tvVolumeSynced = false;
  private renderingControlUrl: string | null = null;
  private renderingControlProbed = false;
  private volumeOpSeq = 0;

  constructor(options: VestelTvControllerOptions = {}) {
    this.configFilePath =
      options.configFilePath !== undefined
        ? options.configFilePath
        : process.env.VITEST === 'true'
          ? null
          : getDefaultVestelConfigFilePath();
    this.onStateChange = options.onStateChange;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.discoverImpl = options.discoverImpl;
    this.tcpSenderImpl = options.tcpSenderImpl ?? sendRawTcpCommand;
    this.delayImpl = options.delayImpl ?? defaultDelay;

    this.loadPersistedConfig();

    if (options.initialHost && isSafeLocalTvHost(options.initialHost) && !this.configuredHost) {
      this.configuredHost = options.initialHost.trim();
    }
    if (options.initialKeepAwake !== undefined && !this.configFilePath) {
      this.keepAwakeEnabled = options.initialKeepAwake;
    }

    this.syncKeepAwakeTimer();
  }

  public getStatus(): VestelTvStatus {
    const activeHost = this.configuredHost ?? this.discoveredHost;
    return {
      configuredHost: this.configuredHost,
      discoveredHost: this.discoveredHost,
      activeHost,
      connected: this.connected && Boolean(activeHost),
      discovering: this.discovering,
      protocolVariant: this.protocolVariant,
      detectedVariant: this.detectedVariant,
      keepAwakeEnabled: this.keepAwakeEnabled,
      keepAwakeIntervalMinutes: this.keepAwakeIntervalMinutes,
      lastKeepAwakeAt: this.lastKeepAwakeAt,
      lastError: this.lastError,
      favoriteChannels: this.favoriteChannels.map((c) => ({ ...c })),
      volume: this.tvVolume,
      muted: this.tvMuted,
      volumeSynced: this.tvVolumeSynced
    };
  }

  private emitChange(): void {
    this.onStateChange?.(this.getStatus());
  }

  private loadPersistedConfig(): void {
    if (!this.configFilePath) return;
    try {
      if (!fs.existsSync(this.configFilePath)) return;
      const raw = fs.readFileSync(this.configFilePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedVestelTvConfig;
      if (!parsed || typeof parsed !== 'object') return;

      if (parsed.configuredHost === null) {
        this.configuredHost = null;
      } else if (isSafeLocalTvHost(parsed.configuredHost)) {
        this.configuredHost = parsed.configuredHost.trim();
      }

      if (
        parsed.protocolVariant === 'auto' ||
        parsed.protocolVariant === 'vr_remote' ||
        parsed.protocolVariant === 'smartcenter' ||
        parsed.protocolVariant === 'raw_tcp'
      ) {
        this.protocolVariant = parsed.protocolVariant;
      }

      if (typeof parsed.keepAwakeEnabled === 'boolean') {
        this.keepAwakeEnabled = parsed.keepAwakeEnabled;
      }

      if (
        typeof parsed.keepAwakeIntervalMinutes === 'number' &&
        Number.isFinite(parsed.keepAwakeIntervalMinutes)
      ) {
        this.keepAwakeIntervalMinutes = clampInteger(parsed.keepAwakeIntervalMinutes, 5, 180);
      }

      if (typeof parsed.lastVolume === 'number' && Number.isFinite(parsed.lastVolume)) {
        this.tvVolume = clampInteger(parsed.lastVolume, 0, 100);
      }

      if (Array.isArray(parsed.favoriteChannels)) {
        const cleanChannels: FavoriteTvChannel[] = [];
        const seenIds = new Set<string>();
        for (const ch of parsed.favoriteChannels) {
          if (!ch || typeof ch !== 'object') continue;
          const id = typeof ch.id === 'string' ? ch.id.trim() : '';
          const name = sanitizeText(ch.name, 40);
          const channelNumber = ch.channelNumber;
          if (
            !/^[a-zA-Z0-9_-]{1,64}$/.test(id) ||
            seenIds.has(id) ||
            !name ||
            typeof channelNumber !== 'number' ||
            !Number.isInteger(channelNumber) ||
            channelNumber < 1 ||
            channelNumber > 9999
          ) {
            continue;
          }
          seenIds.add(id);
          cleanChannels.push({ id, name, channelNumber });
        }
        this.favoriteChannels = cleanChannels.slice(0, 40);
      }
    } catch {
      // Ignore corrupt config file
    }
  }

  private savePersistedConfig(): void {
    if (!this.configFilePath) return;
    try {
      const dir = path.dirname(this.configFilePath);
      fs.mkdirSync(dir, { recursive: true });
      const payload: PersistedVestelTvConfig = {
        configuredHost: this.configuredHost,
        protocolVariant: this.protocolVariant,
        keepAwakeEnabled: this.keepAwakeEnabled,
        keepAwakeIntervalMinutes: this.keepAwakeIntervalMinutes,
        favoriteChannels: this.favoriteChannels,
        lastVolume: this.tvVolume
      };
      fs.writeFileSync(this.configFilePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // Ignore filesystem write failures
    }
  }

  private syncKeepAwakeTimer(): void {
    if (this.keepAwakeTimer) {
      clearInterval(this.keepAwakeTimer);
      this.keepAwakeTimer = null;
    }
    const activeHost = this.configuredHost ?? this.discoveredHost;
    if (!this.keepAwakeEnabled || !activeHost) {
      return;
    }

    const intervalMs = this.keepAwakeIntervalMinutes * 60_000;
    this.keepAwakeTimer = setInterval(() => {
      void this.triggerKeepAwakePulse();
    }, intervalMs);
    this.keepAwakeTimer.unref?.();
  }

  public async triggerKeepAwakePulse(): Promise<boolean> {
    const ok = await this.sendKey('INFO');
    if (!ok) return false;
    await this.delayImpl(450);
    await this.sendKey('EXIT');
    this.lastKeepAwakeAt = Date.now();
    this.emitChange();
    return true;
  }

  public setConfig(update: {
    host?: string | null;
    protocolVariant?: VestelProtocolVariant;
    keepAwakeEnabled?: boolean;
    keepAwakeIntervalMinutes?: number;
  }): { ok: boolean; error?: string } {
    if (update.host !== undefined) {
      if (update.host === null || update.host === '') {
        this.configuredHost = null;
        this.detectedVariant = null;
        this.detectedPort = null;
        this.connected = false;
        this.renderingControlUrl = null;
        this.renderingControlProbed = false;
        this.tvVolumeSynced = false;
      } else if (!isSafeLocalTvHost(update.host)) {
        this.lastError = 'Geçersiz TV IP adresi. Yalnızca yerel ağ (192.168.x.x / 10.x.x.x / .local) adresleri kabul edilir.';
        this.emitChange();
        return { ok: false, error: this.lastError };
      } else {
        this.configuredHost = update.host.trim();
        this.detectedVariant = null;
        this.detectedPort = null;
        this.lastError = null;
        this.renderingControlUrl = null;
        this.renderingControlProbed = false;
        this.tvVolumeSynced = false;
      }
    }

    if (update.protocolVariant !== undefined) {
      this.protocolVariant = update.protocolVariant;
      if (update.protocolVariant !== 'auto') {
        this.detectedVariant = update.protocolVariant;
      } else {
        this.detectedVariant = null;
      }
    }

    if (update.keepAwakeEnabled !== undefined) {
      this.keepAwakeEnabled = update.keepAwakeEnabled;
    }

    if (update.keepAwakeIntervalMinutes !== undefined) {
      this.keepAwakeIntervalMinutes = clampInteger(update.keepAwakeIntervalMinutes, 5, 180);
    }

    this.savePersistedConfig();
    this.syncKeepAwakeTimer();
    this.emitChange();
    return { ok: true };
  }

  public saveFavoriteChannel(input: {
    id?: string;
    name: string;
    channelNumber: number;
  }): void {
    const cleanName = sanitizeText(input.name, 40);
    if (!cleanName) return;
    const channelNumber = clampInteger(input.channelNumber, 1, 9999);
    const id =
      input.id && /^[a-zA-Z0-9_-]{1,64}$/.test(input.id)
        ? input.id
        : `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    const existingIndex = this.favoriteChannels.findIndex((c) => c.id === id);
    const entry: FavoriteTvChannel = { id, name: cleanName, channelNumber };
    if (existingIndex >= 0) {
      this.favoriteChannels[existingIndex] = entry;
    } else if (this.favoriteChannels.length < 40) {
      this.favoriteChannels.push(entry);
    }

    this.favoriteChannels.sort((a, b) => a.channelNumber - b.channelNumber);
    this.savePersistedConfig();
    this.emitChange();
  }

  public deleteFavoriteChannel(id: string): void {
    this.favoriteChannels = this.favoriteChannels.filter((c) => c.id !== id);
    this.savePersistedConfig();
    this.emitChange();
  }

  public async discover(): Promise<string | null> {
    if (this.discovering) {
      return this.discoveredHost;
    }
    this.discovering = true;
    this.lastError = null;
    this.emitChange();

    try {
      const found = this.discoverImpl
        ? await this.discoverImpl()
        : await this.runSsdpDiscovery();

      if (found && isSafeLocalTvHost(found)) {
        this.discoveredHost = found;
        this.connected = true;
        this.lastError = null;
        this.syncKeepAwakeTimer();
        return found;
      }

      if (!this.configuredHost) {
        this.connected = false;
        this.lastError =
          'Ağda Vestel TV bulunamadı. TV ayarlarından "Sanal Kumanda"nın açık olduğundan emin olun veya TV IP adresini manuel girin.';
      }
      return null;
    } catch {
      this.lastError = 'Ağ taraması sırasında hata oluştu.';
      return null;
    } finally {
      this.discovering = false;
      this.emitChange();
    }
  }

  private async sendSsdpOnInterface(
    localIp: string | undefined,
    candidates: Set<string>
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        try {
          socket.close();
        } catch {
          // Ignore close error
        }
        resolve();
      };

      const timeout = setTimeout(done, 1500);

      socket.on('error', () => {
        clearTimeout(timeout);
        done();
      });

      socket.on('message', (msg, rinfo) => {
        const text = msg.toString('utf8');
        if (isSafeLocalTvHost(rinfo.address)) {
          const locationMatch = text.match(/LOCATION:\s*https?:\/\/([^:/\r\n]+)/i);
          const candidateHost = locationMatch?.[1]?.trim() || rinfo.address;
          if (isSafeLocalTvHost(candidateHost)) {
            candidates.add(candidateHost);
          }
        }
      });

      const onBound = () => {
        try {
          const queries = [
            'urn:dial-multiscreen-org:service:dial:1',
            'ssdp:all'
          ];
          for (const st of queries) {
            const packet = Buffer.from(
              [
                'M-SEARCH * HTTP/1.1',
                `HOST: ${SSDP_MULTICAST_ADDR}:${SSDP_PORT}`,
                'MAN: "ssdp:discover"',
                'MX: 1',
                `ST: ${st}`,
                '',
                ''
              ].join('\r\n'),
              'utf8'
            );
            socket.send(packet, 0, packet.length, SSDP_PORT, SSDP_MULTICAST_ADDR);
          }
        } catch {
          clearTimeout(timeout);
          done();
        }
      };

      try {
        if (localIp) {
          socket.bind(0, localIp, onBound);
        } else {
          socket.bind(0, onBound);
        }
      } catch {
        clearTimeout(timeout);
        done();
      }
    });
  }

  private async scanSubnetForVestelTv(localIps: string[]): Promise<string[]> {
    const found: string[] = [];
    const seen = new Set<string>(localIps);
    // Prioritize primary 192.168.x.x / 10.x.x.x subnets (at most first 2 interfaces)
    const targetSubnets = localIps.slice(0, 2);

    for (const selfIp of targetSubnets) {
      const parts = selfIp.split('.');
      if (parts.length !== 4) continue;
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
      const ipsToCheck: string[] = [];
      for (let i = 1; i <= 254; i++) {
        const ip = `${prefix}.${i}`;
        if (!seen.has(ip) && isSafeLocalTvHost(ip)) {
          seen.add(ip);
          ipsToCheck.push(ip);
        }
      }

      const batchSize = 50;
      for (let i = 0; i < ipsToCheck.length; i += batchSize) {
        const batch = ipsToCheck.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (ip) => {
            const openFlags = await Promise.all(
              VESTEL_DIAL_PORTS.map((port) => checkTcpPortOpen(ip, port, 320))
            );
            return openFlags.some(Boolean) ? ip : null;
          })
        );
        for (const ip of results) {
          if (ip) found.push(ip);
        }
      }
    }

    return found;
  }

  private async runSsdpDiscovery(): Promise<string | null> {
    const candidates = new Set<string>();
    const localIps = detectLanIpv4Addresses();

    if (localIps.length > 0) {
      await Promise.all(
        localIps.map((ip) => this.sendSsdpOnInterface(ip, candidates))
      );
    } else {
      await this.sendSsdpOnInterface(undefined, candidates);
    }

    if (this.configuredHost && isSafeLocalTvHost(this.configuredHost)) {
      candidates.add(this.configuredHost);
    }

    let fallbackDialHost: string | null = null;
    for (const host of candidates) {
      const probe = await this.probeVestelHost(host);
      if (probe.isVestel) {
        this.detectedVariant = probe.variant;
        this.detectedPort = probe.port;
        return host;
      }
      if (probe.respondsOnDialPort && !fallbackDialHost) {
        fallbackDialHost = host;
        this.detectedPort = probe.port;
      }
    }

    if (fallbackDialHost) {
      return fallbackDialHost;
    }

    // Fallback: direct local /24 TCP port scan when Windows Firewall / router blocks SSDP multicast
    if (localIps.length > 0) {
      const tcpCandidates = await this.scanSubnetForVestelTv(localIps);
      for (const host of tcpCandidates) {
        const probe = await this.probeVestelHost(host);
        if (probe.isVestel) {
          this.detectedVariant = probe.variant;
          this.detectedPort = probe.port;
          return host;
        }
        if (probe.respondsOnDialPort && !fallbackDialHost) {
          fallbackDialHost = host;
          this.detectedPort = probe.port;
        }
      }
    }

    return fallbackDialHost;
  }

  private async probeVestelHost(host: string): Promise<{
    isVestel: boolean;
    respondsOnDialPort: boolean;
    variant: Exclude<VestelProtocolVariant, 'auto'> | null;
    port: number | null;
  }> {
    if (!isSafeLocalTvHost(host)) {
      return { isVestel: false, respondsOnDialPort: false, variant: null, port: null };
    }

    for (const port of VESTEL_DIAL_PORTS) {
      try {
        const res = await this.fetchImpl(`http://${host}:${port}/dd.xml`, {
          method: 'GET',
          signal: AbortSignal.timeout(1200)
        });
        if (res.ok) {
          const xml = await res.text();
          if (VESTEL_BRAND_HINT_REGEX.test(xml)) {
            return { isVestel: true, respondsOnDialPort: true, variant: null, port };
          }
          return { isVestel: false, respondsOnDialPort: true, variant: null, port };
        }
      } catch {
        // Ignore probe error and try direct app endpoints
      }

      for (const variant of ['vr_remote', 'smartcenter'] as const) {
        const endpoint = variant === 'vr_remote' ? '/apps/vr/remote' : '/apps/SmartCenter';
        try {
          const res = await this.fetchImpl(`http://${host}:${port}${endpoint}`, {
            method: 'GET',
            signal: AbortSignal.timeout(1000)
          });
          if (res.status < 500) {
            return { isVestel: true, respondsOnDialPort: true, variant, port };
          }
        } catch {
          // Ignore
        }
      }
    }

    return { isVestel: false, respondsOnDialPort: false, variant: null, port: null };
  }

  private async sendHttpVariant(
    host: string,
    variant: 'vr_remote' | 'smartcenter',
    code: number
  ): Promise<boolean> {
    const endpoint = variant === 'vr_remote' ? '/apps/vr/remote' : '/apps/SmartCenter';
    const portsToTry = this.detectedPort
      ? [this.detectedPort, ...VESTEL_DIAL_PORTS.filter((p) => p !== this.detectedPort)]
      : [...VESTEL_DIAL_PORTS];

    for (const port of portsToTry) {
      const url = `http://${host}:${port}${endpoint}`;
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/xml; charset=utf-8'
          },
          body: buildRemoteKeyXml(code),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (res.ok || res.status === 201 || res.status === 204) {
          this.detectedPort = port;
          return true;
        }
        // Server responded over HTTP on this port (e.g. 404 for wrong app path), so cache the port and try next variant
        this.detectedPort = port;
        return false;
      } catch {
        // Connection refused/timeout: try next port
      }
    }
    return false;
  }

  private async sendKeyCode(targetHost: string, code: number): Promise<boolean> {
    const order: Array<Exclude<VestelProtocolVariant, 'auto'>> =
      this.protocolVariant !== 'auto'
        ? [this.protocolVariant]
        : this.detectedVariant && this.detectedVariant !== 'raw_tcp'
          ? [
              this.detectedVariant,
              ...(['vr_remote', 'smartcenter'] as const).filter(
                (v) => v !== this.detectedVariant
              )
            ]
          : ['vr_remote', 'smartcenter'];

    for (const variant of order) {
      const ok =
        variant === 'raw_tcp'
          ? await this.tcpSenderImpl(targetHost, code)
          : await this.sendHttpVariant(targetHost, variant, code);

      if (ok) {
        this.detectedVariant = variant;
        this.connected = true;
        this.lastError = null;
        return true;
      }
    }
    return false;
  }

  private async resolveTargetHost(): Promise<string | null> {
    let targetHost = this.configuredHost ?? this.discoveredHost;
    if (!targetHost) {
      targetHost = await this.discover();
    }
    if (!targetHost || !isSafeLocalTvHost(targetHost)) {
      this.connected = false;
      this.lastError =
        'Vestel TV IP adresi tanımlı değil veya bulunamadı. Lütfen "Ağda TV Ara"ya basın veya IP girin.';
      this.emitChange();
      return null;
    }
    return targetHost;
  }

  private async sendUpnpSoap(
    controlUrl: string,
    action: 'GetVolume' | 'SetVolume' | 'GetMute',
    body: string,
    timeoutMs = 1500
  ): Promise<string | null> {
    try {
      const parsed = new URL(controlUrl);
      if (parsed.protocol !== 'http:' || !isSafeLocalTvHost(parsed.hostname)) {
        return null;
      }
      const res = await this.fetchImpl(controlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          SOAPACTION: `"${UPNP_RENDERING_SERVICE}#${action}"`
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  private async probeRenderingControl(host: string): Promise<string | null> {
    this.renderingControlProbed = true;
    if (!isSafeLocalTvHost(host)) return null;

    for (const desc of UPNP_DESC_PATHS) {
      const descUrl = `http://${host}:${desc.port}${desc.path}`;
      try {
        const res = await this.fetchImpl(descUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(900)
        });
        if (res.ok) {
          const xml = await res.text();
          const ctrlUrl = extractRenderingControlUrl(xml, descUrl);
          if (ctrlUrl) {
            const volXml = await this.sendUpnpSoap(ctrlUrl, 'GetVolume', buildUpnpGetVolumeBody(), 900);
            if (volXml) {
              const current = parseUpnpCurrentVolume(volXml);
              if (current !== null) {
                this.tvVolume = current;
                this.tvVolumeSynced = true;
              }
              this.renderingControlUrl = ctrlUrl;
              return ctrlUrl;
            }
          }
        }
      } catch {
        // Ignore description probe failure
      }
    }

    const candidateUrls = UPNP_CONTROL_CANDIDATES.map((c) => `http://${host}:${c.port}${c.path}`);
    const probeResults = await Promise.all(
      candidateUrls.map(async (url) => {
        const volXml = await this.sendUpnpSoap(url, 'GetVolume', buildUpnpGetVolumeBody(), 800);
        if (!volXml) return null;
        const current = parseUpnpCurrentVolume(volXml);
        return current !== null ? { url, current } : null;
      })
    );

    const matched = probeResults.find((r) => r !== null);
    if (matched) {
      this.renderingControlUrl = matched.url;
      this.tvVolume = matched.current;
      this.tvVolumeSynced = true;
      return matched.url;
    }

    this.renderingControlUrl = null;
    return null;
  }

  public async syncVolume(): Promise<boolean> {
    const targetHost = this.configuredHost ?? this.discoveredHost;
    if (!targetHost || !isSafeLocalTvHost(targetHost)) return false;

    const ctrlUrl = this.renderingControlProbed
      ? this.renderingControlUrl
      : await this.probeRenderingControl(targetHost);
    if (!ctrlUrl) return false;

    const volXml = await this.sendUpnpSoap(ctrlUrl, 'GetVolume', buildUpnpGetVolumeBody(), 1200);
    if (!volXml) return false;
    const vol = parseUpnpCurrentVolume(volXml);
    if (vol !== null) {
      this.tvVolume = vol;
      this.tvVolumeSynced = true;
    }

    const muteXml = await this.sendUpnpSoap(ctrlUrl, 'GetMute', buildUpnpGetMuteBody(), 1000);
    if (muteXml) {
      const muteState = parseUpnpCurrentMute(muteXml);
      if (muteState !== null) {
        this.tvMuted = muteState;
      }
    }

    this.connected = true;
    this.emitChange();
    return true;
  }

  public async setVolume(desiredVolume: number): Promise<boolean> {
    const targetHost = await this.resolveTargetHost();
    if (!targetHost) return false;

    const target = clampInteger(desiredVolume, 0, 100);
    const seq = ++this.volumeOpSeq;
    const prevVolume = this.tvVolume;

    this.tvVolume = target;
    if (target > 0) {
      this.tvMuted = false;
    }
    this.emitChange();

    const ctrlUrl = this.renderingControlProbed
      ? this.renderingControlUrl
      : await this.probeRenderingControl(targetHost);
    if (seq !== this.volumeOpSeq) return true;

    if (ctrlUrl) {
      const xml = await this.sendUpnpSoap(
        ctrlUrl,
        'SetVolume',
        buildUpnpSetVolumeBody(target),
        1500
      );
      if (seq !== this.volumeOpSeq) return true;
      if (xml !== null) {
        this.connected = true;
        this.tvVolumeSynced = true;
        this.lastError = null;
        this.savePersistedConfig();
        this.emitChange();
        return true;
      }
    }

    // Fallback: TV does not expose UPnP SetVolume, so step via RC5 VOL_UP / VOL_DOWN
    const diff = target - prevVolume;
    const steps = Math.min(Math.abs(diff), 25);
    const stepKey: VestelKeyName = diff > 0 ? 'VOL_UP' : 'VOL_DOWN';
    const stepCode = VESTEL_KEY_CODE_MAP[stepKey];

    let anySent = steps === 0;
    for (let i = 0; i < steps; i++) {
      if (seq !== this.volumeOpSeq) return true;
      const ok = await this.sendKeyCode(targetHost, stepCode);
      if (!ok) {
        if (!anySent) {
          this.connected = false;
          this.lastError = `TV (${targetHost}) komutlara yanıt vermedi. TV açık mı ve "Sanal Kumanda" etkin mi?`;
          this.emitChange();
        }
        return false;
      }
      anySent = true;
      if (i < steps - 1) {
        await this.delayImpl(75);
      }
    }

    this.savePersistedConfig();
    this.emitChange();
    return true;
  }

  public async sendKey(key: VestelKeyName): Promise<boolean> {
    const code = VESTEL_KEY_CODE_MAP[key];
    if (!code) return false;

    const targetHost = await this.resolveTargetHost();
    if (!targetHost) return false;

    const ok = await this.sendKeyCode(targetHost, code);
    if (ok) {
      if (key === 'VOL_UP') {
        this.tvVolume = clampInteger(this.tvVolume + 1, 0, 100);
        this.tvMuted = false;
        this.savePersistedConfig();
      } else if (key === 'VOL_DOWN') {
        this.tvVolume = clampInteger(this.tvVolume - 1, 0, 100);
        this.savePersistedConfig();
      } else if (key === 'MUTE') {
        this.tvMuted = !this.tvMuted;
      }
      this.emitChange();
      if ((key === 'VOL_UP' || key === 'VOL_DOWN' || key === 'MUTE') && this.renderingControlUrl) {
        void this.syncVolume();
      }
      return true;
    }

    this.connected = false;
    this.lastError = `TV (${targetHost}) komutlara yanıt vermedi. TV açık mı ve "Sanal Kumanda" etkin mi?`;
    this.emitChange();
    return false;
  }

  public async dismissSleepPrompt(strategy: 'exit' | 'right_ok' = 'exit'): Promise<boolean> {
    if (strategy === 'right_ok') {
      const moved = await this.sendKey('RIGHT');
      if (!moved) return false;
      await this.delayImpl(220);
      return this.sendKey('OK');
    }
    return this.sendKey('EXIT');
  }

  public async tuneChannel(channelNumber: number): Promise<boolean> {
    const cleanNum = clampInteger(channelNumber, 1, 9999);
    const digits = String(cleanNum).split('');

    for (let i = 0; i < digits.length; i++) {
      const key = `NUM_${digits[i]}` as VestelKeyName;
      const ok = await this.sendKey(key);
      if (!ok) return false;
      await this.delayImpl(180);
    }

    return this.sendKey('OK');
  }

  public close(): void {
    if (this.keepAwakeTimer) {
      clearInterval(this.keepAwakeTimer);
      this.keepAwakeTimer = null;
    }
  }
}
