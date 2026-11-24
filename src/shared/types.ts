export type ShortcutCategory = 'platform' | 'dizi_site' | 'bookmark';

export type TVSectionId = 'youtube_search' | 'platform' | 'dizi_site' | 'bookmark' | 'watch_later';

export interface TVSectionConfig {
  id: TVSectionId;
  title: string;
  hint: string;
  hidden: boolean;
}

export interface ShortcutItem {
  id: string;
  name: string;
  subtitle: string;
  url: string;
  category: ShortcutCategory;
  color: string;
  badge: string;
  imageUrl?: string;
  internalAction?: 'youtube_home';
  hidden?: boolean;
}

export interface ProgressEntry {
  key: string;
  title: string;
  season?: number;
  episode?: number;
  episodeLabel: string;
  url: string;
  host: string;
  updatedAt: number;
}

export interface ActiveTabCandidate {
  url: string;
  title: string;
  updatedAt: number;
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt?: string;
  thumbnailUrl: string;
  description?: string;
}

export type TVActiveView = 'home' | 'player';

export type PlayerStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error';

export type NavigationDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SELECT';

export type BasicCommandAction =
  | 'PLAY'
  | 'PAUSE'
  | 'TOGGLE_PLAY'
  | 'MUTE'
  | 'UNMUTE'
  | 'TOGGLE_MUTE'
  | 'GO_HOME'
  | 'GO_BACK';

export interface NowPlayingVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl?: string;
}

export interface TVState {
  activeView: TVActiveView;
  nowPlaying: NowPlayingVideo | null;
  playerStatus: PlayerStatus;
  playerErrorCode: number | null;
  playerErrorMessage: string | null;
  volume: number;
  muted: boolean;
  lastCommandLabel: string | null;
  lastCommandAt: number | null;
  lastOpenedShortcut: {
    id: string;
    name: string;
    url: string;
    openedAt: number;
  } | null;
  tvConnectedCount: number;
  remoteConnectedCount: number;
  youtubeApiConfigured: boolean;
  launchAntigravityConfigured?: boolean;
  lanUrls: string[];
  shortcuts: ShortcutItem[];
  sections?: TVSectionConfig[];
  progress?: ProgressEntry[];
  activeTabCandidate?: ActiveTabCandidate | null;
  deletedWatchLaterVideoIds?: string[];
  vestelTv?: VestelTvStatus;
}

export type VestelKeyName =
  | 'POWER'
  | 'OK'
  | 'UP'
  | 'DOWN'
  | 'LEFT'
  | 'RIGHT'
  | 'BACK'
  | 'EXIT'
  | 'MENU'
  | 'INFO'
  | 'SOURCE'
  | 'TV_DTV'
  | 'CH_UP'
  | 'CH_DOWN'
  | 'VOL_UP'
  | 'VOL_DOWN'
  | 'MUTE'
  | 'NUM_0'
  | 'NUM_1'
  | 'NUM_2'
  | 'NUM_3'
  | 'NUM_4'
  | 'NUM_5'
  | 'NUM_6'
  | 'NUM_7'
  | 'NUM_8'
  | 'NUM_9'
  | 'RED'
  | 'GREEN'
  | 'YELLOW'
  | 'BLUE';

export type VestelProtocolVariant = 'auto' | 'vr_remote' | 'smartcenter' | 'raw_tcp';

export interface FavoriteTvChannel {
  id: string;
  name: string;
  channelNumber: number;
}

export interface VestelTvStatus {
  configuredHost: string | null;
  discoveredHost: string | null;
  activeHost: string | null;
  connected: boolean;
  discovering: boolean;
  protocolVariant: VestelProtocolVariant;
  detectedVariant: Exclude<VestelProtocolVariant, 'auto'> | null;
  keepAwakeEnabled: boolean;
  keepAwakeIntervalMinutes: number;
  lastKeepAwakeAt: number | null;
  lastError: string | null;
  favoriteChannels: FavoriteTvChannel[];
  volume?: number;
  muted?: boolean;
  volumeSynced?: boolean;
}

export type MouseButton = 'left' | 'right' | 'middle' | 'double';

export type KeyPressCode =
  | 'SPACE'
  | 'LEFT'
  | 'RIGHT'
  | 'UP'
  | 'DOWN'
  | 'ENTER'
  | 'ESCAPE'
  | 'F'
  | 'M'
  | 'K'
  | 'BACKSPACE'
  | 'TAB'
  | 'DELETE';

export type ValidatedClientMessage =
  | {
      type: 'COMMAND';
      action: BasicCommandAction;
    }
  | {
      type: 'NAVIGATE';
      direction: NavigationDirection;
    }
  | {
      type: 'SET_VOLUME';
      volume: number;
    }
  | {
      type: 'ADJUST_VOLUME';
      delta: number;
    }
  | {
      type: 'PLAY_VIDEO';
      videoId: string;
      title: string;
      channelTitle: string;
      thumbnailUrl?: string;
    }
  | {
      type: 'OPEN_SHORTCUT';
      shortcutId: string;
    }
  | {
      type: 'OPEN_YOUTUBE_EXTERNAL';
      target: 'video' | 'search';
      queryOrVideoId: string;
    }
  | {
      type: 'REORDER_SHORTCUT';
      shortcutId: string;
      direction?: 'PREV' | 'NEXT';
      targetShortcutId?: string;
    }
  | {
      type: 'TOGGLE_SHORTCUT_HIDDEN';
      shortcutId: string;
      hidden?: boolean;
    }
  | {
      type: 'DELETE_SHORTCUT';
      shortcutId: string;
    }
  | {
      type: 'ADD_SHORTCUT';
      name: string;
      url: string;
      category: ShortcutCategory;
      subtitle?: string;
      badge?: string;
      color?: string;
    }
  | {
      type: 'REORDER_SECTION';
      sectionId: TVSectionId;
      direction: 'UP' | 'DOWN';
    }
  | {
      type: 'TOGGLE_SECTION_HIDDEN';
      sectionId: TVSectionId;
      hidden?: boolean;
    }
  | {
      type: 'RESET_LAYOUT';
    }
  | {
      type: 'SAVE_PROGRESS';
      url?: string;
      title?: string;
    }
  | {
      type: 'ADVANCE_PROGRESS';
      key: string;
    }
  | {
      type: 'REMOVE_WATCH_LATER';
      videoId: string;
    }
  | {
      type: 'RESTORE_WATCH_LATER';
      videoId: string;
    }
  | {
      type: 'CLEAR_REMOVED_WATCH_LATER';
    }
  | {
      type: 'LAUNCH_DESKTOP';
      target?: 'all' | 'tv' | 'antigravity';
    }
  | {
      type: 'TV_STATUS_UPDATE';
      state: {
        activeView?: TVActiveView;
        playerStatus?: PlayerStatus;
        playerErrorCode?: number | null;
        playerErrorMessage?: string | null;
        volume?: number;
        muted?: boolean;
      };
    }
  | {
      type: 'PING';
      timestamp?: number;
    }
  | {
      type: 'MOUSE_MOVE';
      dx: number;
      dy: number;
    }
  | {
      type: 'MOUSE_CLICK';
      button: MouseButton;
    }
  | {
      type: 'MOUSE_DOWN';
      button: 'left' | 'right';
    }
  | {
      type: 'MOUSE_UP';
      button: 'left' | 'right';
    }
  | {
      type: 'MOUSE_SCROLL';
      deltaY: number;
      deltaX?: number;
    }
  | {
      type: 'KEY_PRESS';
      key: KeyPressCode;
    }
  | {
      type: 'TYPE_TEXT';
      text: string;
    }
  | {
      type: 'TV_REMOTE_KEY';
      key: VestelKeyName;
    }
  | {
      type: 'TV_DISMISS_SLEEP_PROMPT';
      strategy?: 'exit' | 'right_ok';
    }
  | {
      type: 'TV_TUNE_CHANNEL';
      channelNumber: number;
    }
  | {
      type: 'TV_DISCOVER';
    }
  | {
      type: 'TV_SET_CONFIG';
      host?: string | null;
      protocolVariant?: VestelProtocolVariant;
      keepAwakeEnabled?: boolean;
      keepAwakeIntervalMinutes?: number;
    }
  | {
      type: 'TV_SAVE_FAVORITE_CHANNEL';
      id?: string;
      name: string;
      channelNumber: number;
    }
  | {
      type: 'TV_DELETE_FAVORITE_CHANNEL';
      id: string;
    }
  | {
      type: 'TV_SET_VOLUME';
      volume: number;
    };

export type ServerBroadcastMessage =
  | {
      type: 'STATE_SYNC';
      state: TVState;
    }
  | {
      type: 'TV_COMMAND';
      command: ValidatedClientMessage;
    }
  | {
      type: 'PONG';
      timestamp: number;
    }
  | {
      type: 'ERROR';
      code: string;
      message: string;
    };
