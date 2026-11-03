import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ProgressEntry,
  ServerBroadcastMessage,
  ShortcutItem,
  TVSectionConfig,
  TVState,
  ValidatedClientMessage
} from '../shared/types.js';
import { clampInteger, validateClientMessage } from '../shared/protocol.js';
import { DEFAULT_TV_SECTIONS, isSafeHttpsUrl } from '../shared/shortcuts.js';
import { resolveShortcutIconUrl } from '../shared/platformIcons.js';
import { isPrivateLanIp } from './config.js';
import { SystemAudioController } from './systemAudio.js';
import { DesktopLauncher, type LaunchResult } from './desktopLauncher.js';
import {
  advanceProgressEpisode,
  deleteProgress,
  getDefaultProgressFilePath,
  loadProgress,
  progressEntryToShortcut,
  upsertProgress
} from './progress.js';

type ClientRole = 'tv' | 'remote';

interface PersistedLayoutData {
  shortcuts?: ShortcutItem[];
  deletedShortcutIds?: string[];
  deletedWatchLaterVideoIds?: string[];
  sections?: TVSectionConfig[];
}

function describeCommandInTurkish(
  msg: ValidatedClientMessage,
  shortcuts: ShortcutItem[],
  sections: TVSectionConfig[]
): string {
  switch (msg.type) {
    case 'COMMAND': {
      const map: Record<string, string> = {
        PLAY: 'Oynat (Play)',
        PAUSE: 'Duraklat (Pause)',
        TOGGLE_PLAY: 'Oynat / Duraklat',
        MUTE: 'Sesi Kapat (Mute)',
        UNMUTE: 'Sesi Aç (Unmute)',
        TOGGLE_MUTE: 'Ses Aç / Kapat',
        GO_HOME: 'Ana Ekrana Dön',
        GO_BACK: 'Geri Dön'
      };
      return map[msg.action] ?? msg.action;
    }
    case 'NAVIGATE': {
      const dirMap: Record<string, string> = {
        UP: 'Yukarı',
        DOWN: 'Aşağı',
        LEFT: 'Sol',
        RIGHT: 'Sağ',
        SELECT: 'Seç (OK)'
      };
      return `Yön: ${dirMap[msg.direction] ?? msg.direction}`;
    }
    case 'SET_VOLUME':
      return `Ses Seviyesi: %${msg.volume}`;
    case 'ADJUST_VOLUME':
      return `Ses Ayarı: ${msg.delta > 0 ? `+${msg.delta}` : msg.delta}`;
    case 'PLAY_VIDEO':
      return `Video Aç: ${msg.title}`;
    case 'OPEN_SHORTCUT': {
      const found = shortcuts.find((s) => s.id === msg.shortcutId);
      return `Kısayol Aç: ${found ? found.name : msg.shortcutId}`;
    }
    case 'OPEN_YOUTUBE_EXTERNAL':
      return msg.target === 'video'
        ? 'YouTube Sekmesinde Video Aç'
        : `YouTube'da Ara: "${msg.queryOrVideoId}"`;
    case 'REORDER_SHORTCUT': {
      const found = shortcuts.find((s) => s.id === msg.shortcutId);
      return `Sıralama Değiştirildi: ${found ? found.name : msg.shortcutId}`;
    }
    case 'TOGGLE_SHORTCUT_HIDDEN': {
      const found = shortcuts.find((s) => s.id === msg.shortcutId);
      const willHide = msg.hidden !== undefined ? msg.hidden : !found?.hidden;
      return `${found ? found.name : msg.shortcutId} ${willHide ? 'Gizlendi' : 'Gösterildi'}`;
    }
    case 'DELETE_SHORTCUT': {
      const found = shortcuts.find((s) => s.id === msg.shortcutId);
      return `Silindi: ${found ? found.name : msg.shortcutId}`;
    }
    case 'ADD_SHORTCUT':
      return `Yeni Eklendi: ${msg.name}`;
    case 'REORDER_SECTION': {
      const sec = sections.find((s) => s.id === msg.sectionId);
      return `Sekme Sırası Değiştirildi: ${sec ? sec.title : msg.sectionId}`;
    }
    case 'TOGGLE_SECTION_HIDDEN': {
      const sec = sections.find((s) => s.id === msg.sectionId);
      const willHide = msg.hidden !== undefined ? msg.hidden : !sec?.hidden;
      return `Sekme ${willHide ? 'Gizlendi' : 'Gösterildi'}: ${sec ? sec.title : msg.sectionId}`;
    }
    case 'RESET_LAYOUT':
      return 'Arayüz Düzeni Varsayılanlara Sıfırlandı';
    case 'SAVE_PROGRESS':
      return 'Kaldığın Bölüm Kaydedildi';
    case 'ADVANCE_PROGRESS':
      return 'Sonraki Bölüme Geçildi (+1)';
    case 'LAUNCH_DESKTOP':
      if (msg.target === 'antigravity') return 'Antigravity Bilgisayarda Başlatıldı';
      if (msg.target === 'all') return 'TV & Antigravity Bilgisayarda Başlatıldı';
      return 'TV Bilgisayarda Başlatıldı';
    case 'REMOVE_WATCH_LATER':
      return 'Sonra İzle Listesinden Kaldırıldı';
    case 'RESTORE_WATCH_LATER':
      return 'Sonra İzle Listesine Geri Eklendi';
    case 'CLEAR_REMOVED_WATCH_LATER':
      return 'Kaldırılan Videolar Sıfırlandı';
    case 'MOUSE_MOVE':
      return 'Fare Hareketi';
    case 'MOUSE_CLICK': {
      const clickMap: Record<string, string> = {
        left: 'Sol Tık',
        right: 'Sağ Tık',
        middle: 'Orta Tık',
        double: 'Çift Tık'
      };
      return clickMap[msg.button] ?? 'Fare Tıklaması';
    }
    case 'MOUSE_DOWN':
      return `Fare Basılı (${msg.button === 'left' ? 'Sol' : 'Sağ'})`;
    case 'MOUSE_UP':
      return `Fare Bırakıldı (${msg.button === 'left' ? 'Sol' : 'Sağ'})`;
    case 'MOUSE_SCROLL':
      return `Sayfa Kaydırma (${msg.deltaY < 0 ? 'Aşağı' : 'Yukarı'})`;
    case 'KEY_PRESS': {
      const keyMap: Record<string, string> = {
        SPACE: 'Oynat / Durdur (Boşluk)',
        LEFT: '10 sn Geri (Sol Ok)',
        RIGHT: '10 sn İleri (Sağ Ok)',
        UP: 'Yukarı Ok',
        DOWN: 'Aşağı Ok',
        F: 'Tam Ekran (F)',
        M: 'Sesi Kapat / Aç (M)',
        ESCAPE: 'Çıkış (Esc)',
        ENTER: 'Seç (Enter)',
        K: 'Oynat / Durdur (K)',
        TAB: 'Sekme (Tab)',
        BACKSPACE: 'Geri Silme',
        DELETE: 'İleri Sil (Del)'
      };
      return `Tuş: ${keyMap[msg.key] ?? msg.key}`;
    }
    case 'TYPE_TEXT':
      return `Metin Yazma: "${msg.text.length > 20 ? msg.text.slice(0, 20) + '...' : msg.text}"`;
    default:
      return msg.type;
  }
}

export class WsHub {
  private readonly wss: WebSocketServer;
  private readonly tvClients = new Set<WebSocket>();
  private readonly remoteClients = new Set<WebSocket>();
  private readonly initialShortcuts: ShortcutItem[];
  private readonly allowedShortcutIds: Set<string>;
  private readonly deletedShortcutIds = new Set<string>();
  private readonly deletedWatchLaterVideoIds = new Set<string>();
  private readonly shortcutMap: Map<string, ShortcutItem>;
  private readonly persistLayoutPath: string | null;
  private readonly progressFilePath: string;
  private readonly heartbeatInterval: NodeJS.Timeout;
  private readonly systemAudio: SystemAudioController;
  private lastWakeDisplayAt = 0;
  private readonly desktopLauncher: DesktopLauncher;
  private readonly launchAntigravity: boolean;
  private readonly autoLaunchTv: boolean;
  private state: TVState;

  constructor(
    server: HttpServer,
    options: {
      shortcuts: ShortcutItem[];
      allowedShortcutIds: ReadonlySet<string>;
      youtubeApiConfigured: boolean;
      lanUrls: string[];
      persistLayoutPath?: string | null;
      progressFilePath?: string;
      systemAudio?: SystemAudioController;
      desktopLauncher?: DesktopLauncher;
      port?: number;
      launchAntigravity?: boolean;
      autoLaunchTv?: boolean;
    }
  ) {
    this.initialShortcuts = options.shortcuts.map((s) => ({ ...s, hidden: Boolean(s.hidden) }));
    this.allowedShortcutIds = new Set(options.allowedShortcutIds);
    this.shortcutMap = new Map(this.initialShortcuts.map((s) => [s.id, { ...s }]));
    this.progressFilePath = options.progressFilePath ?? getDefaultProgressFilePath();
    this.launchAntigravity =
      options.launchAntigravity ??
      (process.env.LAUNCH_ANTIGRAVITY?.toLowerCase() === 'true' ||
       process.env.LAUNCH_ANTIGRAVITY === '1');
    this.autoLaunchTv =
      options.autoLaunchTv ??
      (process.env.AUTO_LAUNCH_TV?.toLowerCase() === 'true' ||
       process.env.AUTO_LAUNCH_TV === '1');
    this.desktopLauncher =
      options.desktopLauncher ??
      new DesktopLauncher({
        port: options.port,
        launchAntigravity: this.launchAntigravity
      });

    this.persistLayoutPath =
      options.persistLayoutPath !== undefined
        ? options.persistLayoutPath
        : process.env.VITEST === 'true'
          ? null
          : path.resolve(process.cwd(), '.tv-layout.json');

    const defaultSections = DEFAULT_TV_SECTIONS.map((sec) => ({ ...sec }));
    const initialProgress = loadProgress(this.progressFilePath);

    this.state = {
      activeView: 'home',
      nowPlaying: null,
      playerStatus: 'idle',
      playerErrorCode: null,
      playerErrorMessage: null,
      volume: 80,
      muted: false,
      lastCommandLabel: null,
      lastCommandAt: null,
      lastOpenedShortcut: null,
      tvConnectedCount: 0,
      remoteConnectedCount: 0,
      youtubeApiConfigured: options.youtubeApiConfigured,
      launchAntigravityConfigured: this.launchAntigravity,
      lanUrls: options.lanUrls,
      shortcuts: this.initialShortcuts.map((s) => ({ ...s })),
      sections: defaultSections,
      progress: initialProgress,
      activeTabCandidate: null,
      deletedWatchLaterVideoIds: []
    };

    this.loadPersistedLayout();

    this.systemAudio =
      options.systemAudio ??
      new SystemAudioController({
        onStateSync: (audioState) => {
          this.state.volume = audioState.volume;
          this.state.muted = audioState.muted;
          this.broadcastState();
        }
      });

    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      maxPayload: 16 * 1024, // 16 KB strict payload boundary
      verifyClient: (info, callback) => {
        const origin = info.origin || info.req.headers.origin;
        if (!origin) {
          // Allow non-browser clients (native apps, test runner, curl) without an Origin header
          callback(true);
          return;
        }

        try {
          const u = new URL(origin);
          const host = u.hostname.toLowerCase();
          const isAllowed =
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            isPrivateLanIp(host);

          if (isAllowed) {
            callback(true);
          } else {
            callback(false, 403, 'Forbidden: Cross-site WebSocket connections are not allowed.');
          }
        } catch {
          callback(false, 400, 'Bad Request: Malformed Origin header.');
        }
      }
    });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    // Clean up dead/zombie sockets every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      let stateChanged = false;
      for (const client of this.wss.clients) {
        const clientWithAlive = client as WebSocket & { isAlive?: boolean };
        if (clientWithAlive.isAlive === false) {
          this.tvClients.delete(client);
          this.remoteClients.delete(client);
          client.terminate();
          stateChanged = true;
          continue;
        }
        clientWithAlive.isAlive = false;
        client.ping();
      }
      if (stateChanged) {
        this.broadcastState();
      }
    }, 30000);
  }

  public getState(): TVState {
    return {
      ...this.state,
      tvConnectedCount: this.tvClients.size,
      remoteConnectedCount: this.remoteClients.size
    };
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientWithAlive = ws as WebSocket & { isAlive?: boolean };
    clientWithAlive.isAlive = true;

    ws.on('pong', () => {
      clientWithAlive.isAlive = true;
    });

    const reqUrl = new URL(req.url ?? '/ws', 'http://localhost');
    const roleParam = reqUrl.searchParams.get('role');
    const role: ClientRole = roleParam === 'tv' ? 'tv' : 'remote';

    if (role === 'tv') {
      this.tvClients.add(ws);
      setTimeout(() => this.systemAudio.ensureBookmarksBarHidden(), 250);
      setTimeout(() => this.systemAudio.ensureBookmarksBarHidden(), 1200);
    } else {
      this.remoteClients.add(ws);
      if (this.autoLaunchTv && this.tvClients.size === 0) {
        void this.desktopLauncher.ensureDesktopApps({
          tvConnectedCount: 0
        });
      }
    }

    this.broadcastState();

    ws.on('message', (data) => {
      const rawText = typeof data === 'string' ? data : data.toString('utf8');
      this.handleClientMessage(ws, role, rawText);
    });

    ws.on('close', () => {
      this.tvClients.delete(ws);
      this.remoteClients.delete(ws);
      this.broadcastState();
    });

    ws.on('error', () => {
      this.tvClients.delete(ws);
      this.remoteClients.delete(ws);
    });
  }

  private handleClientMessage(ws: WebSocket, _role: ClientRole, rawText: string): void {
    const validation = validateClientMessage(rawText, this.allowedShortcutIds);

    if (!validation.ok || !validation.message) {
      this.sendToClient(ws, {
        type: 'ERROR',
        code: 'INVALID_COMMAND',
        message: validation.error ?? 'Geçersiz komut formatı.'
      });
      return;
    }

    const msg = validation.message;

    if (msg.type === 'PING') {
      this.sendToClient(ws, {
        type: 'PONG',
        timestamp: msg.timestamp ?? Date.now()
      });
      return;
    }

    if (msg.type === 'TV_STATUS_UPDATE') {
      this.systemAudio.ensureBookmarksBarHidden();
      const st = msg.state;
      if (st.activeView !== undefined) this.state.activeView = st.activeView;
      if (st.playerStatus !== undefined) this.state.playerStatus = st.playerStatus;
      if (st.playerErrorCode !== undefined) this.state.playerErrorCode = st.playerErrorCode;
      if (st.playerErrorMessage !== undefined) {
        this.state.playerErrorMessage = st.playerErrorMessage;
      }
      if (st.volume !== undefined) this.state.volume = st.volume;
      if (st.muted !== undefined) this.state.muted = st.muted;
      this.broadcastState();
      return;
    }

    if (msg.type === 'ADD_SHORTCUT' && this.state.shortcuts.length >= 60) {
      this.sendToClient(ws, {
        type: 'ERROR',
        code: 'LIMIT_REACHED',
        message: 'Maksimum kısayol sınırına (60) ulaşıldı. Yeni eklemek için mevcut olanları silin.'
      });
      return;
    }

    this.executeCommand(msg);
  }

  public updateNowPlayingMetadata(videoId: string, title: string, channelTitle: string): void {
    if (!this.state.nowPlaying || this.state.nowPlaying.videoId !== videoId) return;
    this.state.nowPlaying = {
      ...this.state.nowPlaying,
      title,
      channelTitle
    };
    this.broadcastState();
  }

  public executeCommand(msg: ValidatedClientMessage): void {
    // Wake display at most once every 5s; doing it per message floods the input bridge
    // (each wake is an extra jitter move) and made the mouse/scroll lag or stall.
    const nowMs = Date.now();
    if (nowMs - this.lastWakeDisplayAt > 5000) {
      this.lastWakeDisplayAt = nowMs;
      this.systemAudio.wakeDisplay();
    }

    // Ultra-low-latency path for high-frequency mouse and keyboard events
    if (msg.type === 'MOUSE_MOVE') {
      this.systemAudio.mouseMove(msg.dx, msg.dy);
      return;
    }
    if (msg.type === 'MOUSE_SCROLL') {
      this.systemAudio.mouseScroll(msg.deltaY, msg.deltaX);
      return;
    }
    if (msg.type === 'MOUSE_DOWN') {
      this.systemAudio.mouseDown(msg.button);
      return;
    }
    if (msg.type === 'MOUSE_UP') {
      this.systemAudio.mouseUp(msg.button);
      return;
    }
    if (msg.type === 'MOUSE_CLICK') {
      this.systemAudio.mouseClick(msg.button);
      this.state.lastCommandLabel = describeCommandInTurkish(
        msg,
        this.state.shortcuts,
        this.state.sections ?? DEFAULT_TV_SECTIONS
      );
      this.state.lastCommandAt = Date.now();
      return;
    }
    if (msg.type === 'KEY_PRESS') {
      this.systemAudio.sendKey(msg.key);
      if (msg.key === 'SPACE') {
        this.systemAudio.sendMediaPlayPause();
      }
      this.state.lastCommandLabel = describeCommandInTurkish(
        msg,
        this.state.shortcuts,
        this.state.sections ?? DEFAULT_TV_SECTIONS
      );
      this.state.lastCommandAt = Date.now();
      return;
    }
    if (msg.type === 'TYPE_TEXT') {
      this.systemAudio.sendText(msg.text);
      this.state.lastCommandLabel = describeCommandInTurkish(
        msg,
        this.state.shortcuts,
        this.state.sections ?? DEFAULT_TV_SECTIONS
      );
      this.state.lastCommandAt = Date.now();
      return;
    }

    // Record command metadata
    this.state.lastCommandLabel = describeCommandInTurkish(
      msg,
      this.state.shortcuts,
      this.state.sections ?? DEFAULT_TV_SECTIONS
    );
    this.state.lastCommandAt = Date.now();

    // Update authoritative server state based on command
    switch (msg.type) {
      case 'PLAY_VIDEO': {
        this.state.activeView = 'player';
        this.state.nowPlaying = {
          videoId: msg.videoId,
          title: msg.title,
          channelTitle: msg.channelTitle,
          thumbnailUrl: msg.thumbnailUrl ?? `https://i.ytimg.com/vi/${msg.videoId}/mqdefault.jpg`
        };
        this.state.playerStatus = 'loading';
        this.state.playerErrorCode = null;
        this.state.playerErrorMessage = null;
        break;
      }

      case 'COMMAND': {
        if (msg.action === 'GO_HOME') {
          this.state.activeView = 'home';
        } else if (msg.action === 'GO_BACK') {
          if (this.state.activeView === 'player') {
            this.state.activeView = 'home';
          }
        } else if (msg.action === 'PLAY') {
          if (this.state.nowPlaying && this.state.activeView === 'player') {
            this.state.playerStatus = 'playing';
          } else {
            this.systemAudio.sendMediaPlayPause();
          }
        } else if (msg.action === 'PAUSE') {
          if (this.state.nowPlaying && this.state.activeView === 'player') {
            this.state.playerStatus = 'paused';
          } else {
            this.systemAudio.sendMediaPlayPause();
          }
        } else if (msg.action === 'TOGGLE_PLAY') {
          if (this.state.nowPlaying && this.state.activeView === 'player') {
            this.state.playerStatus =
              this.state.playerStatus === 'playing' ? 'paused' : 'playing';
          } else {
            this.systemAudio.sendMediaPlayPause();
          }
        } else if (msg.action === 'MUTE') {
          this.state.muted = true;
          this.systemAudio.setMute(true);
        } else if (msg.action === 'UNMUTE') {
          this.state.muted = false;
          this.systemAudio.setMute(false);
        } else if (msg.action === 'TOGGLE_MUTE') {
          this.state.muted = !this.state.muted;
          this.systemAudio.setMute(this.state.muted);
        }
        break;
      }

      case 'SET_VOLUME': {
        this.state.volume = msg.volume;
        if (msg.volume > 0 && this.state.muted) {
          this.state.muted = false;
          this.systemAudio.setMute(false);
        }
        this.systemAudio.setVolume(this.state.volume);
        break;
      }

      case 'ADJUST_VOLUME': {
        this.state.volume = clampInteger(this.state.volume + msg.delta, 0, 100);
        if (this.state.volume > 0 && this.state.muted && msg.delta > 0) {
          this.state.muted = false;
          this.systemAudio.setMute(false);
        }
        this.systemAudio.setVolume(this.state.volume);
        break;
      }

      case 'OPEN_SHORTCUT': {
        const item = this.shortcutMap.get(msg.shortcutId);
        if (item) {
          if (item.internalAction === 'youtube_home') {
            if (this.state.nowPlaying) {
              this.state.activeView = 'player';
            } else {
              this.state.activeView = 'home';
            }
          } else {
            this.state.lastOpenedShortcut = {
              id: item.id,
              name: item.name,
              url: item.url,
              openedAt: Date.now()
            };
          }
        }
        break;
      }

      case 'REORDER_SHORTCUT': {
        this.handleReorderShortcut(msg.shortcutId, msg.direction, msg.targetShortcutId);
        this.savePersistedLayout();
        break;
      }

      case 'TOGGLE_SHORTCUT_HIDDEN': {
        const target = this.state.shortcuts.find((s) => s.id === msg.shortcutId);
        if (target) {
          target.hidden = msg.hidden !== undefined ? msg.hidden : !target.hidden;
          this.shortcutMap.set(target.id, target);
          this.savePersistedLayout();
        }
        break;
      }

      case 'DELETE_SHORTCUT': {
        if (msg.shortcutId.startsWith('bm-series-')) {
          deleteProgress(msg.shortcutId, this.progressFilePath);
          this.state.progress = loadProgress(this.progressFilePath);
        }
        this.state.shortcuts = this.state.shortcuts.filter((s) => s.id !== msg.shortcutId);
        this.shortcutMap.delete(msg.shortcutId);
        this.allowedShortcutIds.delete(msg.shortcutId);
        this.deletedShortcutIds.add(msg.shortcutId);
        this.savePersistedLayout();
        break;
      }

      case 'ADD_SHORTCUT': {
        if (this.state.shortcuts.length >= 60) {
          break;
        }
        if (msg.category === 'bookmark') {
          const combinedTitle = msg.subtitle ? `${msg.name} - ${msg.subtitle}` : msg.name;
          upsertProgress(
            {
              url: msg.url,
              title: combinedTitle
            },
            this.progressFilePath
          );
          this.syncProgressFromDisk(false);
          break;
        }
        const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const resolvedIcon = resolveShortcutIconUrl(id, msg.url);
        const newShortcut: ShortcutItem = {
          id,
          name: msg.name,
          subtitle: msg.subtitle ?? '',
          url: msg.url,
          category: msg.category,
          color:
            msg.color ??
            (msg.category === 'platform'
              ? '#3b6b82'
              : msg.category === 'dizi_site'
                ? '#7c3aed'
                : '#0891b2'),
          badge:
            msg.badge ?? msg.name.slice(0, 3).toUpperCase(),
          ...(resolvedIcon ? { imageUrl: resolvedIcon } : {}),
          hidden: false
        };
        this.state.shortcuts.push(newShortcut);
        this.shortcutMap.set(newShortcut.id, newShortcut);
        this.allowedShortcutIds.add(newShortcut.id);
        this.savePersistedLayout();
        break;
      }

      case 'REORDER_SECTION': {
        const sections = [...(this.state.sections ?? DEFAULT_TV_SECTIONS)];
        const idx = sections.findIndex((sec) => sec.id === msg.sectionId);
        if (idx !== -1) {
          const swapIdx = msg.direction === 'UP' ? idx - 1 : idx + 1;
          if (swapIdx >= 0 && swapIdx < sections.length) {
            const temp = sections[idx];
            sections[idx] = sections[swapIdx];
            sections[swapIdx] = temp;
            this.state.sections = sections;
            this.savePersistedLayout();
          }
        }
        break;
      }

      case 'TOGGLE_SECTION_HIDDEN': {
        const sections = (this.state.sections ?? DEFAULT_TV_SECTIONS).map((sec) => {
          if (sec.id !== msg.sectionId) return sec;
          return {
            ...sec,
            hidden: msg.hidden !== undefined ? msg.hidden : !sec.hidden
          };
        });
        this.state.sections = sections;
        this.savePersistedLayout();
        break;
      }

      case 'RESET_LAYOUT': {
        this.deletedShortcutIds.clear();
        this.deletedWatchLaterVideoIds.clear();
        this.state.deletedWatchLaterVideoIds = [];
        this.state.shortcuts = this.initialShortcuts.map((s) => ({ ...s, hidden: false }));
        this.state.sections = DEFAULT_TV_SECTIONS.map((sec) => ({ ...sec, hidden: false }));
        this.shortcutMap.clear();
        this.allowedShortcutIds.clear();
        for (const item of this.state.shortcuts) {
          this.shortcutMap.set(item.id, item);
          this.allowedShortcutIds.add(item.id);
        }
        this.syncProgressFromDisk(false);
        this.savePersistedLayout();
        break;
      }

      case 'REMOVE_WATCH_LATER': {
        this.deletedWatchLaterVideoIds.add(msg.videoId);
        this.state.deletedWatchLaterVideoIds = Array.from(this.deletedWatchLaterVideoIds);
        this.savePersistedLayout();
        break;
      }

      case 'RESTORE_WATCH_LATER': {
        this.deletedWatchLaterVideoIds.delete(msg.videoId);
        this.state.deletedWatchLaterVideoIds = Array.from(this.deletedWatchLaterVideoIds);
        this.savePersistedLayout();
        break;
      }

      case 'CLEAR_REMOVED_WATCH_LATER': {
        this.deletedWatchLaterVideoIds.clear();
        this.state.deletedWatchLaterVideoIds = [];
        this.savePersistedLayout();
        break;
      }

      case 'SAVE_PROGRESS': {
        const targetUrl =
          msg.url ??
          this.state.activeTabCandidate?.url ??
          this.state.lastOpenedShortcut?.url;
        const targetTitle =
          msg.title ??
          this.state.activeTabCandidate?.title ??
          this.state.lastOpenedShortcut?.name ??
          '';

        if (targetUrl && isSafeHttpsUrl(targetUrl)) {
          const saved = upsertProgress(
            {
              url: targetUrl,
              title: targetTitle
            },
            this.progressFilePath
          );
          this.state.lastCommandLabel = `Kaydedildi: ${saved.title} (${saved.episodeLabel})`;
          this.syncProgressFromDisk(false);
        }
        break;
      }

      case 'ADVANCE_PROGRESS': {
        const updated = advanceProgressEpisode(msg.key, this.progressFilePath);
        if (updated) {
          this.state.lastCommandLabel = `İlerletildi: ${updated.title} (${updated.episodeLabel})`;
          this.syncProgressFromDisk(false);
        }
        break;
      }

      case 'OPEN_YOUTUBE_EXTERNAL': {
        this.state.activeView = 'home';
        this.state.playerStatus = 'idle';
        break;
      }

      case 'LAUNCH_DESKTOP': {
        const target = msg.target ?? (this.launchAntigravity ? 'all' : 'tv');
        if (target === 'antigravity' || (target === 'all' && this.launchAntigravity)) {
          this.systemAudio.focusAntigravity();
        }
        this.systemAudio.wakeDisplay();
        if (target === 'tv' || target === 'all') {
          this.systemAudio.focusTvLauncher();
        }
        void this.desktopLauncher.ensureDesktopApps({
          tvConnectedCount: target === 'antigravity' ? 1 : this.tvClients.size,
          forceTv: target === 'tv' || target === 'all',
          forceAntigravity:
            target === 'antigravity' || target === 'all'
              ? true
              : (target === 'tv' ? false : undefined)
        });
        break;
      }
      case 'NAVIGATE':
        break;
    }

    // Forward command to all connected TV clients
    const tvPayload: ServerBroadcastMessage = {
      type: 'TV_COMMAND',
      command: msg
    };
    for (const tvClient of this.tvClients) {
      this.sendToClient(tvClient, tvPayload);
    }

    this.broadcastState();
  }

  private handleReorderShortcut(
    shortcutId: string,
    direction?: 'PREV' | 'NEXT',
    targetShortcutId?: string
  ): void {
    const item = this.state.shortcuts.find((s) => s.id === shortcutId);
    if (!item) return;

    const isHiddenGroup = Boolean(item.hidden);
    const groupIndices: number[] = [];
    this.state.shortcuts.forEach((s, idx) => {
      if (s.category === item.category && Boolean(s.hidden) === isHiddenGroup) {
        groupIndices.push(idx);
      }
    });

    if (groupIndices.length < 2) return;

    const groupItems = groupIndices.map((i) => this.state.shortcuts[i]);
    const currentPos = groupItems.findIndex((s) => s.id === shortcutId);
    if (currentPos === -1) return;

    if (targetShortcutId && targetShortcutId !== shortcutId) {
      const targetPos = groupItems.findIndex((s) => s.id === targetShortcutId);
      if (targetPos === -1) return;
      const [moved] = groupItems.splice(currentPos, 1);
      groupItems.splice(targetPos, 0, moved);
    } else if (direction) {
      const swapPos = direction === 'PREV' ? currentPos - 1 : currentPos + 1;
      if (swapPos < 0 || swapPos >= groupItems.length) return;
      const temp = groupItems[currentPos];
      groupItems[currentPos] = groupItems[swapPos];
      groupItems[swapPos] = temp;
    } else {
      return;
    }

    const updated = [...this.state.shortcuts];
    groupIndices.forEach((globalIdx, i) => {
      updated[globalIdx] = groupItems[i];
    });
    this.state.shortcuts = updated;
  }

  private loadPersistedLayout(): void {
    if (!this.persistLayoutPath) return;
    try {
      if (!fs.existsSync(this.persistLayoutPath)) return;
      const raw = fs.readFileSync(this.persistLayoutPath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedLayoutData;
      if (!parsed || typeof parsed !== 'object') return;

      if (Array.isArray(parsed.deletedShortcutIds)) {
        for (const id of parsed.deletedShortcutIds) {
          if (typeof id === 'string') {
            this.deletedShortcutIds.add(id);
          }
        }
      }

      if (Array.isArray(parsed.deletedWatchLaterVideoIds)) {
        this.deletedWatchLaterVideoIds.clear();
        for (const id of parsed.deletedWatchLaterVideoIds) {
          if (typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id.trim())) {
            this.deletedWatchLaterVideoIds.add(id.trim());
          }
        }
        this.state.deletedWatchLaterVideoIds = Array.from(this.deletedWatchLaterVideoIds);
      }

      if (Array.isArray(parsed.shortcuts) && parsed.shortcuts.length > 0) {
        const initialById = new Map(this.initialShortcuts.map((item) => [item.id, item]));
        const merged: ShortcutItem[] = [];
        const seenIds = new Set<string>();

        for (const saved of parsed.shortcuts) {
          if (!saved || typeof saved !== 'object' || typeof saved.id !== 'string') continue;
          if (this.deletedShortcutIds.has(saved.id) || seenIds.has(saved.id)) continue;

          const freshInitial = initialById.get(saved.id);
          if (freshInitial) {
            seenIds.add(saved.id);
            merged.push({
              ...freshInitial,
              hidden: Boolean(saved.hidden)
            });
            continue;
          }

          // Skip stale series bookmark entries that are no longer in data/progress.json
          if (saved.id.startsWith('bm-series-')) {
            continue;
          }

          if (!isSafeHttpsUrl(saved.url)) continue;
          seenIds.add(saved.id);
          const category =
            saved.category === 'dizi_site' || saved.category === 'bookmark'
              ? saved.category
              : 'platform';
          const cleanName = String(saved.name || '').slice(0, 90);
          merged.push({
            id: saved.id,
            name: cleanName,
            subtitle: String(saved.subtitle || '').slice(0, 100),
            url: saved.url,
            category,
            color: typeof saved.color === 'string' ? saved.color : '#3b6b82',
            badge: typeof saved.badge === 'string' ? saved.badge : 'APP',
            ...(typeof saved.imageUrl === 'string' && saved.imageUrl
              ? { imageUrl: saved.imageUrl }
              : category === 'bookmark'
                ? { imageUrl: `/api/series-poster?q=${encodeURIComponent(cleanName)}` }
                : {}),
            hidden: Boolean(saved.hidden)
          });
        }

        // Append any newly synced initial shortcuts that weren't deleted or seen yet
        for (const initial of this.initialShortcuts) {
          if (!seenIds.has(initial.id) && !this.deletedShortcutIds.has(initial.id)) {
            seenIds.add(initial.id);
            merged.push({ ...initial, hidden: Boolean(initial.hidden) });
          }
        }

        this.state.shortcuts = merged;
        this.shortcutMap.clear();
        this.allowedShortcutIds.clear();
        for (const item of merged) {
          this.shortcutMap.set(item.id, item);
          this.allowedShortcutIds.add(item.id);
        }
      }

      if (Array.isArray(parsed.sections) && parsed.sections.length > 0) {
        const defaultMap = new Map(DEFAULT_TV_SECTIONS.map((s) => [s.id, s]));
        const mergedSections: TVSectionConfig[] = [];
        const seenSections = new Set<string>();

        for (const sec of parsed.sections) {
          if (!sec || typeof sec !== 'object' || typeof sec.id !== 'string') continue;
          const base = defaultMap.get(sec.id as TVSectionConfig['id']);
          if (!base || seenSections.has(base.id)) continue;
          seenSections.add(base.id);
          mergedSections.push({
            id: base.id,
            title: base.title,
            hint: base.hint,
            hidden: Boolean(sec.hidden)
          });
        }

        for (const def of DEFAULT_TV_SECTIONS) {
          if (!seenSections.has(def.id)) {
            mergedSections.push({ ...def });
          }
        }

        this.state.sections = mergedSections;
      }
    } catch {
      // Ignore corrupt or inaccessible layout persistence file
    }
  }

  private savePersistedLayout(): void {
    if (!this.persistLayoutPath) return;
    try {
      const payload: PersistedLayoutData = {
        shortcuts: this.state.shortcuts,
        deletedShortcutIds: Array.from(this.deletedShortcutIds),
        deletedWatchLaterVideoIds: Array.from(this.deletedWatchLaterVideoIds),
        sections: this.state.sections
      };
      fs.writeFileSync(this.persistLayoutPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // Ignore write failures on read-only filesystems
    }
  }

  public getDeletedWatchLaterVideoIds(): string[] {
    return Array.from(this.deletedWatchLaterVideoIds);
  }

  public removeWatchLaterVideo(videoId: string): void {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;
    this.deletedWatchLaterVideoIds.add(videoId);
    this.state.deletedWatchLaterVideoIds = Array.from(this.deletedWatchLaterVideoIds);
    this.state.lastCommandLabel = 'Sonra İzle Listesinden Kaldırıldı';
    this.state.lastCommandAt = Date.now();
    this.savePersistedLayout();
    this.broadcastState();
  }

  public restoreWatchLaterVideo(videoId: string): void {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;
    this.deletedWatchLaterVideoIds.delete(videoId);
    this.state.deletedWatchLaterVideoIds = Array.from(this.deletedWatchLaterVideoIds);
    this.state.lastCommandLabel = 'Sonra İzle Listesine Geri Eklendi';
    this.state.lastCommandAt = Date.now();
    this.savePersistedLayout();
    this.broadcastState();
  }

  public clearRemovedWatchLaterVideos(): void {
    this.deletedWatchLaterVideoIds.clear();
    this.state.deletedWatchLaterVideoIds = [];
    this.state.lastCommandLabel = 'Kaldırılan Videolar Sıfırlandı';
    this.state.lastCommandAt = Date.now();
    this.savePersistedLayout();
    this.broadcastState();
  }

  public setActiveTabCandidate(url: string, title: string): void {
    if (!isSafeHttpsUrl(url)) return;
    this.state.activeTabCandidate = {
      url: url.trim(),
      title: title.trim(),
      updatedAt: Date.now()
    };
    this.broadcastState();
  }

  public syncProgressFromDisk(shouldBroadcast = true): ProgressEntry[] {
    const entries = loadProgress(this.progressFilePath);
    this.state.progress = entries;

    const existingHiddenById = new Map<string, boolean>();
    for (const item of this.state.shortcuts) {
      if (item.category === 'bookmark') {
        existingHiddenById.set(item.id, Boolean(item.hidden));
      }
    }

    const nonBookmarks = this.state.shortcuts.filter(
      (s) => s.category !== 'bookmark' || !s.id.startsWith('bm-series-')
    );
    const customBookmarks = nonBookmarks.filter((s) => s.category === 'bookmark');
    const otherCategories = nonBookmarks.filter((s) => s.category !== 'bookmark');

    const progressShortcuts = entries.map((entry) => {
      const sc = progressEntryToShortcut(entry);
      this.deletedShortcutIds.delete(sc.id);
      return {
        ...sc,
        hidden: existingHiddenById.get(sc.id) ?? false
      };
    });

    const combined = [...otherCategories, ...progressShortcuts, ...customBookmarks];
    this.state.shortcuts = combined;
    this.shortcutMap.clear();
    this.allowedShortcutIds.clear();
    for (const item of combined) {
      this.shortcutMap.set(item.id, item);
      this.allowedShortcutIds.add(item.id);
    }

    this.savePersistedLayout();
    if (shouldBroadcast) {
      this.broadcastState();
    }
    return entries;
  }

  private broadcastState(): void {
    const syncMessage: ServerBroadcastMessage = {
      type: 'STATE_SYNC',
      state: this.getState()
    };

    for (const client of this.tvClients) {
      this.sendToClient(client, syncMessage);
    }
    for (const client of this.remoteClients) {
      this.sendToClient(client, syncMessage);
    }
  }

  private sendToClient(ws: WebSocket, payload: ServerBroadcastMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  public async ensureDesktopAppsRunning(options?: {
    forceTv?: boolean;
    forceAntigravity?: boolean;
  }): Promise<LaunchResult> {
    const shouldFocusAntigravity =
      options?.forceAntigravity === true ||
      (options?.forceAntigravity === undefined && this.launchAntigravity);

    if (shouldFocusAntigravity) {
      this.systemAudio.focusAntigravity();
    }
    this.systemAudio.wakeDisplay();
    if (options?.forceTv === true) {
      this.systemAudio.focusTvLauncher();
    }

    return this.desktopLauncher.ensureDesktopApps({
      tvConnectedCount: this.tvClients.size,
      forceTv: options?.forceTv,
      forceAntigravity: options?.forceAntigravity
    });
  }

  public close(): Promise<void> {
    clearInterval(this.heartbeatInterval);
    this.systemAudio.close();
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}
