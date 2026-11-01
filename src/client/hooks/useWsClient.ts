import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ServerBroadcastMessage,
  TVState,
  ValidatedClientMessage
} from '../../shared/types.js';
import {
  DEFAULT_SHORTCUTS,
  DEFAULT_TV_SECTIONS,
  FALLBACK_DIZI_BOOKMARKS
} from '../../shared/shortcuts.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

const INITIAL_TV_STATE: TVState = {
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
  youtubeApiConfigured: false,
  lanUrls: [],
  shortcuts: [...DEFAULT_SHORTCUTS, ...FALLBACK_DIZI_BOOKMARKS],
  sections: [...DEFAULT_TV_SECTIONS]
};

export function useWsClient(
  role: 'tv' | 'remote',
  onTvCommand?: (command: ValidatedClientMessage) => void
) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [serverState, setServerState] = useState<TVState>(INITIAL_TV_STATE);
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const onTvCommandRef = useRef(onTvCommand);
  onTvCommandRef.current = onTvCommand;

  const connect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?role=${role}`;

    setConnectionStatus((prev) => (prev === 'connected' ? 'connected' : 'reconnecting'));

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      setConnectionStatus('connected');
      setLastError(null);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as ServerBroadcastMessage;
        if (msg.type === 'STATE_SYNC') {
          setServerState(msg.state);
        } else if (msg.type === 'TV_COMMAND') {
          onTvCommandRef.current?.(msg.command);
        } else if (msg.type === 'ERROR') {
          setLastError(msg.message);
        }
      } catch {
        // Ignore malformed server payload
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setConnectionStatus('reconnecting');
      const attempt = reconnectAttemptsRef.current;
      reconnectAttemptsRef.current = attempt + 1;
      const delay = Math.min(1000 * Math.pow(1.6, attempt), 4000);
      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [role]);

  useEffect(() => {
    connect();

    // Immediately recover WebSocket when iPhone Safari wakes from sleep or regains Wi-Fi
    const handleVisibilityOrOnline = () => {
      if (document.visibilityState === 'visible') {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          reconnectAttemptsRef.current = 0;
          connect();
        } else {
          wsRef.current.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrOnline);
    window.addEventListener('online', handleVisibilityOrOnline);
    window.addEventListener('focus', handleVisibilityOrOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrOnline);
      window.removeEventListener('online', handleVisibilityOrOnline);
      window.removeEventListener('focus', handleVisibilityOrOnline);
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const sendCommand = useCallback((message: ValidatedClientMessage): boolean => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    return false;
  }, []);

  return {
    connectionStatus,
    serverState,
    lastError,
    sendCommand,
    reconnectNow: connect
  };
}
