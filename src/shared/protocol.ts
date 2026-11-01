import type {
  BasicCommandAction,
  KeyPressCode,
  MouseButton,
  NavigationDirection,
  PlayerStatus,
  ShortcutCategory,
  TVActiveView,
  TVSectionId,
  ValidatedClientMessage
} from './types.js';
import { isSafeHttpsUrl } from './shortcuts.js';

const YOUTUBE_VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const SHORTCUT_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{3,8}$/;

const ALLOWED_CATEGORIES = new Set<ShortcutCategory>(['platform', 'dizi_site', 'bookmark']);
const ALLOWED_SECTION_IDS = new Set<TVSectionId>([
  'youtube_search',
  'platform',
  'dizi_site',
  'bookmark',
  'watch_later'
]);

const ALLOWED_BASIC_ACTIONS = new Set<BasicCommandAction>([
  'PLAY',
  'PAUSE',
  'TOGGLE_PLAY',
  'MUTE',
  'UNMUTE',
  'TOGGLE_MUTE',
  'GO_HOME',
  'GO_BACK'
]);

const ALLOWED_MOUSE_BUTTONS = new Set<MouseButton>(['left', 'right', 'middle', 'double']);

const ALLOWED_KEY_PRESSES = new Set<KeyPressCode>([
  'SPACE',
  'LEFT',
  'RIGHT',
  'UP',
  'DOWN',
  'ENTER',
  'ESCAPE',
  'F',
  'M',
  'K',
  'BACKSPACE',
  'TAB'
]);

const ALLOWED_DIRECTIONS = new Set<NavigationDirection>([
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
  'SELECT'
]);

const ALLOWED_VIEWS = new Set<TVActiveView>(['home', 'player']);

const ALLOWED_PLAYER_STATUSES = new Set<PlayerStatus>([
  'idle',
  'loading',
  'playing',
  'paused',
  'buffering',
  'ended',
  'error'
]);

export function isValidYouTubeVideoId(videoId: unknown): videoId is string {
  return typeof videoId === 'string' && YOUTUBE_VIDEO_ID_REGEX.test(videoId.trim());
}

function extractVideoIdFromUrlString(urlCandidate: string): string | null {
  try {
    const url = new URL(urlCandidate);
    const host = url.hostname.toLowerCase();

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0] ?? '';
      return YOUTUBE_VIDEO_ID_REGEX.test(id) ? id : null;
    }

    if (
      host === 'youtube.com' ||
      host === 'www.youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    ) {
      const vParam = url.searchParams.get('v');
      if (vParam && YOUTUBE_VIDEO_ID_REGEX.test(vParam)) {
        return vParam;
      }

      const segments = url.pathname.split('/').filter(Boolean);
      if (
        segments.length >= 2 &&
        (segments[0] === 'embed' ||
          segments[0] === 'shorts' ||
          segments[0] === 'live' ||
          segments[0] === 'v')
      ) {
        const candidate = segments[1];
        return YOUTUBE_VIDEO_ID_REGEX.test(candidate) ? candidate : null;
      }
    }
  } catch {
    // Not a URL
  }
  return null;
}

/**
 * Extracts a strict 11-character YouTube Video ID from either a raw 11-char ID,
 * any official YouTube URL (youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., youtube.com/embed/...),
 * or shared text containing a YouTube URL (e.g. from iOS YouTube Share Sheet).
 * Returns null if the input does not contain a valid YouTube video ID.
 */
export function extractYouTubeVideoId(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 1000) return null;

  if (YOUTUBE_VIDEO_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  const direct = extractVideoIdFromUrlString(trimmed);
  if (direct) {
    return direct;
  }

  // Handle shared text from mobile apps containing title + URL (e.g. "Video Title https://youtu.be/dQw4w9WgXcQ?si=...")
  const urlMatches = trimmed.match(/https?:\/\/[^\s"'<>]+/gi);
  if (urlMatches) {
    for (const rawMatch of urlMatches) {
      const cleanedUrl = rawMatch.replace(/[).,;!?]+$/, '');
      const extracted = extractVideoIdFromUrlString(cleanedUrl);
      if (extracted) {
        return extracted;
      }
    }
  }

  return null;
}

export function sanitizeText(input: unknown, maxLength = 120, fallback = ''): string {
  if (typeof input !== 'string') return fallback;
  const cleaned = input.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, maxLength) : fallback;
}

export function sanitizeSearchQuery(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 120);
}

export function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function buildSafeYouTubeExternalUrl(
  target: 'video' | 'search',
  queryOrVideoId: string
): string | null {
  if (target === 'video') {
    const id = extractYouTubeVideoId(queryOrVideoId);
    if (!id) return null;
    return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  }
  if (target === 'search') {
    const q = sanitizeSearchQuery(queryOrVideoId);
    if (!q) return null;
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
  }
  return null;
}

export interface ValidationResult {
  ok: boolean;
  message?: ValidatedClientMessage;
  error?: string;
}

/**
 * Strictly validates and sanitizes raw WebSocket JSON messages from clients.
 * Rejects unknown message types, out-of-range numbers, invalid video IDs, or unapproved shortcut IDs.
 */
export function validateClientMessage(
  rawInput: unknown,
  allowedShortcutIds?: ReadonlySet<string>
): ValidationResult {
  let parsed: unknown = rawInput;

  if (typeof rawInput === 'string') {
    if (rawInput.length > 16384) {
      return { ok: false, error: 'Payload exceeds maximum allowed length.' };
    }
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      return { ok: false, error: 'Invalid JSON format.' };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Message must be a JSON object.' };
  }

  const obj = parsed as Record<string, unknown>;
  const type = obj.type;

  if (typeof type !== 'string') {
    return { ok: false, error: 'Missing or invalid message type.' };
  }

  switch (type) {
    case 'COMMAND': {
      const action = obj.action;
      if (typeof action !== 'string' || !ALLOWED_BASIC_ACTIONS.has(action as BasicCommandAction)) {
        return { ok: false, error: `Unsupported command action: ${String(action)}` };
      }
      return {
        ok: true,
        message: {
          type: 'COMMAND',
          action: action as BasicCommandAction
        }
      };
    }

    case 'NAVIGATE': {
      const direction = obj.direction;
      if (
        typeof direction !== 'string' ||
        !ALLOWED_DIRECTIONS.has(direction as NavigationDirection)
      ) {
        return { ok: false, error: `Unsupported navigation direction: ${String(direction)}` };
      }
      return {
        ok: true,
        message: {
          type: 'NAVIGATE',
          direction: direction as NavigationDirection
        }
      };
    }

    case 'SET_VOLUME': {
      const volume = obj.volume;
      if (typeof volume !== 'number' || !Number.isFinite(volume)) {
        return { ok: false, error: 'Volume must be a finite number.' };
      }
      return {
        ok: true,
        message: {
          type: 'SET_VOLUME',
          volume: clampInteger(volume, 0, 100)
        }
      };
    }

    case 'ADJUST_VOLUME': {
      const delta = obj.delta;
      if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
        return { ok: false, error: 'Volume delta must be a non-zero finite number.' };
      }
      return {
        ok: true,
        message: {
          type: 'ADJUST_VOLUME',
          delta: clampInteger(delta, -100, 100)
        }
      };
    }

    case 'PLAY_VIDEO': {
      const rawId = typeof obj.videoId === 'string' ? extractYouTubeVideoId(obj.videoId) : null;
      if (!rawId) {
        return { ok: false, error: 'Invalid YouTube videoId.' };
      }
      const title = sanitizeText(obj.title, 160, 'YouTube Videosu');
      const channelTitle = sanitizeText(obj.channelTitle, 100, 'YouTube');
      const rawThumb = typeof obj.thumbnailUrl === 'string' ? obj.thumbnailUrl.trim() : undefined;
      const thumbnailUrl = rawThumb && isSafeHttpsUrl(rawThumb) ? rawThumb : undefined;

      return {
        ok: true,
        message: {
          type: 'PLAY_VIDEO',
          videoId: rawId,
          title,
          channelTitle,
          thumbnailUrl
        }
      };
    }

    case 'OPEN_SHORTCUT': {
      const shortcutId = typeof obj.shortcutId === 'string' ? obj.shortcutId.trim() : '';
      if (!SHORTCUT_ID_REGEX.test(shortcutId)) {
        return { ok: false, error: 'Invalid shortcutId format.' };
      }
      if (allowedShortcutIds && !allowedShortcutIds.has(shortcutId)) {
        return { ok: false, error: `Unknown or unauthorized shortcutId: ${shortcutId}` };
      }
      return {
        ok: true,
        message: {
          type: 'OPEN_SHORTCUT',
          shortcutId
        }
      };
    }

    case 'OPEN_YOUTUBE_EXTERNAL': {
      const target = obj.target;
      if (target !== 'video' && target !== 'search') {
        return { ok: false, error: 'Invalid external YouTube target.' };
      }
      const rawValue = typeof obj.queryOrVideoId === 'string' ? obj.queryOrVideoId.trim() : '';
      if (target === 'video') {
        const videoId = extractYouTubeVideoId(rawValue);
        if (!videoId) {
          return { ok: false, error: 'Invalid YouTube videoId for external open.' };
        }
        return {
          ok: true,
          message: {
            type: 'OPEN_YOUTUBE_EXTERNAL',
            target: 'video',
            queryOrVideoId: videoId
          }
        };
      } else {
        const query = sanitizeSearchQuery(rawValue);
        if (!query) {
          return { ok: false, error: 'Search query cannot be empty.' };
        }
        return {
          ok: true,
          message: {
            type: 'OPEN_YOUTUBE_EXTERNAL',
            target: 'search',
            queryOrVideoId: query
          }
        };
      }
    }

    case 'REORDER_SHORTCUT': {
      const shortcutId = typeof obj.shortcutId === 'string' ? obj.shortcutId.trim() : '';
      if (!SHORTCUT_ID_REGEX.test(shortcutId)) {
        return { ok: false, error: 'Invalid shortcutId format.' };
      }
      if (allowedShortcutIds && !allowedShortcutIds.has(shortcutId)) {
        return { ok: false, error: `Unknown shortcutId: ${shortcutId}` };
      }

      const direction = obj.direction;
      const targetShortcutId =
        typeof obj.targetShortcutId === 'string' ? obj.targetShortcutId.trim() : undefined;

      if (direction !== undefined && direction !== 'PREV' && direction !== 'NEXT') {
        return { ok: false, error: 'Invalid reorder direction.' };
      }

      if (targetShortcutId !== undefined) {
        if (!SHORTCUT_ID_REGEX.test(targetShortcutId)) {
          return { ok: false, error: 'Invalid targetShortcutId format.' };
        }
        if (allowedShortcutIds && !allowedShortcutIds.has(targetShortcutId)) {
          return { ok: false, error: `Unknown targetShortcutId: ${targetShortcutId}` };
        }
      }

      if (!direction && !targetShortcutId) {
        return { ok: false, error: 'REORDER_SHORTCUT requires direction or targetShortcutId.' };
      }

      return {
        ok: true,
        message: {
          type: 'REORDER_SHORTCUT',
          shortcutId,
          ...(direction ? { direction } : {}),
          ...(targetShortcutId ? { targetShortcutId } : {})
        }
      };
    }

    case 'TOGGLE_SHORTCUT_HIDDEN': {
      const shortcutId = typeof obj.shortcutId === 'string' ? obj.shortcutId.trim() : '';
      if (!SHORTCUT_ID_REGEX.test(shortcutId)) {
        return { ok: false, error: 'Invalid shortcutId format.' };
      }
      if (allowedShortcutIds && !allowedShortcutIds.has(shortcutId)) {
        return { ok: false, error: `Unknown shortcutId: ${shortcutId}` };
      }
      if (obj.hidden !== undefined && typeof obj.hidden !== 'boolean') {
        return { ok: false, error: 'Invalid hidden boolean flag.' };
      }
      return {
        ok: true,
        message: {
          type: 'TOGGLE_SHORTCUT_HIDDEN',
          shortcutId,
          ...(typeof obj.hidden === 'boolean' ? { hidden: obj.hidden } : {})
        }
      };
    }

    case 'DELETE_SHORTCUT': {
      const shortcutId = typeof obj.shortcutId === 'string' ? obj.shortcutId.trim() : '';
      if (!SHORTCUT_ID_REGEX.test(shortcutId)) {
        return { ok: false, error: 'Invalid shortcutId format.' };
      }
      if (allowedShortcutIds && !allowedShortcutIds.has(shortcutId)) {
        return { ok: false, error: `Unknown shortcutId: ${shortcutId}` };
      }
      return {
        ok: true,
        message: {
          type: 'DELETE_SHORTCUT',
          shortcutId
        }
      };
    }

    case 'ADD_SHORTCUT': {
      const name = sanitizeText(obj.name, 80, '');
      if (!name) {
        return { ok: false, error: 'Shortcut name is required.' };
      }
      const rawUrl = typeof obj.url === 'string' ? obj.url.trim() : '';
      if (!isSafeHttpsUrl(rawUrl)) {
        return { ok: false, error: 'Shortcut URL must be a valid https:// address.' };
      }
      const rawCategory = obj.category;
      if (
        typeof rawCategory !== 'string' ||
        !ALLOWED_CATEGORIES.has(rawCategory as ShortcutCategory)
      ) {
        return { ok: false, error: 'Invalid shortcut category.' };
      }
      const subtitle =
        typeof obj.subtitle === 'string' && obj.subtitle.trim()
          ? sanitizeText(obj.subtitle, 100, '')
          : undefined;
      const badge =
        typeof obj.badge === 'string' && obj.badge.trim()
          ? sanitizeText(obj.badge, 6, '').toUpperCase()
          : undefined;
      const color =
        typeof obj.color === 'string' && HEX_COLOR_REGEX.test(obj.color.trim())
          ? obj.color.trim()
          : undefined;

      return {
        ok: true,
        message: {
          type: 'ADD_SHORTCUT',
          name,
          url: rawUrl,
          category: rawCategory as ShortcutCategory,
          ...(subtitle ? { subtitle } : {}),
          ...(badge ? { badge } : {}),
          ...(color ? { color } : {})
        }
      };
    }

    case 'REORDER_SECTION': {
      const sectionId = obj.sectionId;
      if (typeof sectionId !== 'string' || !ALLOWED_SECTION_IDS.has(sectionId as TVSectionId)) {
        return { ok: false, error: 'Invalid sectionId.' };
      }
      const direction = obj.direction;
      if (direction !== 'UP' && direction !== 'DOWN') {
        return { ok: false, error: 'Invalid section reorder direction.' };
      }
      return {
        ok: true,
        message: {
          type: 'REORDER_SECTION',
          sectionId: sectionId as TVSectionId,
          direction
        }
      };
    }

    case 'TOGGLE_SECTION_HIDDEN': {
      const sectionId = obj.sectionId;
      if (typeof sectionId !== 'string' || !ALLOWED_SECTION_IDS.has(sectionId as TVSectionId)) {
        return { ok: false, error: 'Invalid sectionId.' };
      }
      if (obj.hidden !== undefined && typeof obj.hidden !== 'boolean') {
        return { ok: false, error: 'Invalid hidden boolean flag.' };
      }
      return {
        ok: true,
        message: {
          type: 'TOGGLE_SECTION_HIDDEN',
          sectionId: sectionId as TVSectionId,
          ...(typeof obj.hidden === 'boolean' ? { hidden: obj.hidden } : {})
        }
      };
    }

    case 'RESET_LAYOUT': {
      return {
        ok: true,
        message: {
          type: 'RESET_LAYOUT'
        }
      };
    }

    case 'SAVE_PROGRESS': {
      const rawUrl = typeof obj.url === 'string' && obj.url.trim() ? obj.url.trim() : undefined;
      if (rawUrl !== undefined && !isSafeHttpsUrl(rawUrl)) {
        return { ok: false, error: 'Progress URL must be a valid https:// address.' };
      }
      const title =
        typeof obj.title === 'string' && obj.title.trim()
          ? sanitizeText(obj.title, 160, '')
          : undefined;

      return {
        ok: true,
        message: {
          type: 'SAVE_PROGRESS',
          ...(rawUrl ? { url: rawUrl } : {}),
          ...(title ? { title } : {})
        }
      };
    }

    case 'ADVANCE_PROGRESS': {
      const rawKey = typeof obj.key === 'string' ? obj.key.trim() : '';
      const cleanKey = rawKey.replace(/^bm-series-/, '');
      if (!cleanKey || !SHORTCUT_ID_REGEX.test(cleanKey)) {
        return { ok: false, error: 'Invalid series key for ADVANCE_PROGRESS.' };
      }
      return {
        ok: true,
        message: {
          type: 'ADVANCE_PROGRESS',
          key: cleanKey
        }
      };
    }

    case 'REMOVE_WATCH_LATER': {
      const videoId = typeof obj.videoId === 'string' ? obj.videoId.trim() : '';
      if (!isValidYouTubeVideoId(videoId)) {
        return { ok: false, error: 'Invalid videoId format for REMOVE_WATCH_LATER.' };
      }
      return {
        ok: true,
        message: {
          type: 'REMOVE_WATCH_LATER',
          videoId
        }
      };
    }

    case 'RESTORE_WATCH_LATER': {
      const videoId = typeof obj.videoId === 'string' ? obj.videoId.trim() : '';
      if (!isValidYouTubeVideoId(videoId)) {
        return { ok: false, error: 'Invalid videoId format for RESTORE_WATCH_LATER.' };
      }
      return {
        ok: true,
        message: {
          type: 'RESTORE_WATCH_LATER',
          videoId
        }
      };
    }

    case 'CLEAR_REMOVED_WATCH_LATER': {
      return {
        ok: true,
        message: {
          type: 'CLEAR_REMOVED_WATCH_LATER'
        }
      };
    }

    case 'LAUNCH_DESKTOP': {
      const rawTarget =
        typeof obj.target === 'string' ? obj.target.trim().toLowerCase() : undefined;
      const target =
        rawTarget === 'tv' || rawTarget === 'antigravity' || rawTarget === 'all'
          ? (rawTarget as 'all' | 'tv' | 'antigravity')
          : 'tv';
      return {
        ok: true,
        message: {
          type: 'LAUNCH_DESKTOP',
          target
        }
      };
    }

    case 'TV_STATUS_UPDATE': {
      const rawState = obj.state;
      if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
        return { ok: false, error: 'Invalid TV_STATUS_UPDATE state object.' };
      }
      const st = rawState as Record<string, unknown>;
      const sanitizedState: Extract<
        ValidatedClientMessage,
        { type: 'TV_STATUS_UPDATE' }
      >['state'] = {};

      if (st.activeView !== undefined) {
        if (typeof st.activeView !== 'string' || !ALLOWED_VIEWS.has(st.activeView as TVActiveView)) {
          return { ok: false, error: 'Invalid activeView in TV_STATUS_UPDATE.' };
        }
        sanitizedState.activeView = st.activeView as TVActiveView;
      }

      if (st.playerStatus !== undefined) {
        if (
          typeof st.playerStatus !== 'string' ||
          !ALLOWED_PLAYER_STATUSES.has(st.playerStatus as PlayerStatus)
        ) {
          return { ok: false, error: 'Invalid playerStatus in TV_STATUS_UPDATE.' };
        }
        sanitizedState.playerStatus = st.playerStatus as PlayerStatus;
      }

      if (st.playerErrorCode !== undefined) {
        if (st.playerErrorCode === null) {
          sanitizedState.playerErrorCode = null;
        } else if (typeof st.playerErrorCode === 'number' && Number.isFinite(st.playerErrorCode)) {
          sanitizedState.playerErrorCode = Math.trunc(st.playerErrorCode);
        } else {
          return { ok: false, error: 'Invalid playerErrorCode in TV_STATUS_UPDATE.' };
        }
      }

      if (st.playerErrorMessage !== undefined) {
        if (st.playerErrorMessage === null) {
          sanitizedState.playerErrorMessage = null;
        } else if (typeof st.playerErrorMessage === 'string') {
          sanitizedState.playerErrorMessage = sanitizeText(st.playerErrorMessage, 240, '');
        }
      }

      if (st.volume !== undefined) {
        if (typeof st.volume !== 'number' || !Number.isFinite(st.volume)) {
          return { ok: false, error: 'Invalid volume in TV_STATUS_UPDATE.' };
        }
        sanitizedState.volume = clampInteger(st.volume, 0, 100);
      }

      if (st.muted !== undefined) {
        if (typeof st.muted !== 'boolean') {
          return { ok: false, error: 'Invalid muted flag in TV_STATUS_UPDATE.' };
        }
        sanitizedState.muted = st.muted;
      }

      return {
        ok: true,
        message: {
          type: 'TV_STATUS_UPDATE',
          state: sanitizedState
        }
      };
    }

    case 'PING': {
      const ts =
        typeof obj.timestamp === 'number' && Number.isFinite(obj.timestamp)
          ? obj.timestamp
          : Date.now();
      return {
        ok: true,
        message: {
          type: 'PING',
          timestamp: ts
        }
      };
    }

    case 'MOUSE_MOVE': {
      const dx = obj.dx;
      const dy = obj.dy;
      if (
        typeof dx !== 'number' ||
        !Number.isFinite(dx) ||
        typeof dy !== 'number' ||
        !Number.isFinite(dy)
      ) {
        return { ok: false, error: 'Mouse move deltas must be finite numbers.' };
      }
      return {
        ok: true,
        message: {
          type: 'MOUSE_MOVE',
          dx: clampInteger(dx, -500, 500),
          dy: clampInteger(dy, -500, 500)
        }
      };
    }

    case 'MOUSE_CLICK': {
      const button = obj.button;
      if (typeof button !== 'string' || !ALLOWED_MOUSE_BUTTONS.has(button as MouseButton)) {
        return { ok: false, error: `Invalid mouse click button: ${String(button)}` };
      }
      return {
        ok: true,
        message: {
          type: 'MOUSE_CLICK',
          button: button as MouseButton
        }
      };
    }

    case 'MOUSE_DOWN': {
      const button = obj.button;
      if (button !== 'left' && button !== 'right') {
        return { ok: false, error: 'Invalid mouse down button. Only left or right allowed.' };
      }
      return {
        ok: true,
        message: {
          type: 'MOUSE_DOWN',
          button
        }
      };
    }

    case 'MOUSE_UP': {
      const button = obj.button;
      if (button !== 'left' && button !== 'right') {
        return { ok: false, error: 'Invalid mouse up button. Only left or right allowed.' };
      }
      return {
        ok: true,
        message: {
          type: 'MOUSE_UP',
          button
        }
      };
    }

    case 'MOUSE_SCROLL': {
      const deltaY = obj.deltaY;
      if (typeof deltaY !== 'number' || !Number.isFinite(deltaY)) {
        return { ok: false, error: 'Scroll deltaY must be a finite number.' };
      }
      const deltaX =
        typeof obj.deltaX === 'number' && Number.isFinite(obj.deltaX)
          ? clampInteger(obj.deltaX, -1000, 1000)
          : undefined;

      return {
        ok: true,
        message: {
          type: 'MOUSE_SCROLL',
          deltaY: clampInteger(deltaY, -2000, 2000),
          ...(deltaX !== undefined ? { deltaX } : {})
        }
      };
    }

    case 'KEY_PRESS': {
      const key = obj.key;
      if (typeof key !== 'string' || !ALLOWED_KEY_PRESSES.has(key as KeyPressCode)) {
        return { ok: false, error: `Unsupported key press: ${String(key)}` };
      }
      return {
        ok: true,
        message: {
          type: 'KEY_PRESS',
          key: key as KeyPressCode
        }
      };
    }

    default:
      return { ok: false, error: `Unknown message type: ${type}` };
  }
}
