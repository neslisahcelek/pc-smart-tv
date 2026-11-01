import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Mouse,
  Clapperboard,
  Gamepad2,
  Monitor,
  Sun,
  Moon,
  Tv,
  Pause,
  Play,
  ExternalLink,
  Trash2,
  Home,
  Undo2,
  Volume2,
  Volume1,
  VolumeX,
  BookmarkCheck,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Sparkles,
  Clock,
  RotateCw,
  RotateCcw,
  LayoutGrid,
  Bookmark,
  Check,
  SlidersHorizontal,
  Eye,
  EyeOff,
  Plus,
  Film
} from 'lucide-react';
import { useWsClient } from '../hooks/useWsClient.js';
import { useThemeScheme } from '../hooks/useThemeScheme.js';
import { extractYouTubeVideoId } from '../../shared/protocol.js';
import { DEFAULT_TV_SECTIONS } from '../../shared/shortcuts.js';
import { resolveShortcutIconUrl } from '../../shared/platformIcons.js';
import type { ShortcutItem, YouTubeSearchResult } from '../../shared/types.js';
import type { YouTubeSearchResponse } from '../../server/youtube.js';
import { TouchpadView } from './TouchpadView.js';

function YouTubeIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="5" />
      <polygon points="10 8.5 16 12 10 15.5 10 8.5" fill="currentColor" />
    </svg>
  );
}

type RemoteTab = 'mouse' | 'youtube' | 'media' | 'controls';

const STATUS_LABELS: Record<string, string> = {
  idle: 'Boşta',
  loading: 'Yükleniyor...',
  playing: 'Oynatılıyor',
  paused: 'Duraklatıldı',
  buffering: 'Ara Belleğe Alınıyor...',
  ended: 'Bitti',
  error: 'Oynatma Hatası'
};

export function RemoteApp() {
  const { connectionStatus, serverState, sendCommand, reconnectNow } = useWsClient('remote');
  const { isDark, toggleScheme } = useThemeScheme();

  const [activeTab, setActiveTab] = useState<RemoteTab>('mouse');
  const [mediaSubTab, setMediaSubTab] = useState<'platforms' | 'bookmarks'>('bookmarks');
  const [searchInput, setSearchInput] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
  const [searchError, setSearchError] = useState<{
    message: string;
    fallbackQuery: string;
  } | null>(null);
  const [bookmarkFilter, setBookmarkFilter] = useState('');
  const [playlistVideos, setPlaylistVideos] = useState<YouTubeSearchResult[]>([]);
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [showRemovedWatchLater, setShowRemovedWatchLater] = useState(false);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [playlistRefreshing, setPlaylistRefreshing] = useState(false);

  const loadPlaylist = useCallback((forceRefresh = false) => {
    if (forceRefresh) setPlaylistRefreshing(true);
    const url = forceRefresh ? '/api/youtube/playlist?refresh=true' : '/api/youtube/playlist';
    return fetch(url)
      .then((r) => r.json())
      .then((data: {
        ok: boolean;
        results?: YouTubeSearchResult[];
        allResults?: YouTubeSearchResult[];
        playlistId?: string | null;
        errorMessage?: string;
      }) => {
        const all = data.ok ? (data.allResults ?? data.results ?? []) : [];
        setPlaylistVideos(all);
        if (data.playlistId) setPlaylistId(data.playlistId);
        setPlaylistError(data.ok ? null : (data.errorMessage ?? 'Liste yüklenemedi.'));
        if (forceRefresh) {
          triggerFeedback(data.ok ? `Liste güncellendi (${all.length})` : 'Güncellenemedi');
        }
      })
      .catch(() => {
        setPlaylistError('Sonra İzle listesi yüklenemedi.');
        if (forceRefresh) triggerFeedback('Bağlantı hatası');
      })
      .finally(() => {
        setPlaylistRefreshing(false);
      });
  }, []);

  useEffect(() => {
    if (activeTab !== 'youtube') return;
    loadPlaylist(false);
  }, [activeTab, loadPlaylist]);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [remoteEditMode, setRemoteEditMode] = useState(false);
  const [isShareSetupDismissed, setIsShareSetupDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tv_hide_share_setup') === 'true';
    } catch {
      return false;
    }
  });

  const triggerFeedback = (label: string) => {
    setFeedbackToast(label);
    window.setTimeout(() => {
      setFeedbackToast((prev) => (prev === label ? null : prev));
    }, 2000);
  };

  const deletedWatchLaterSet = useMemo(
    () => new Set(serverState.deletedWatchLaterVideoIds ?? []),
    [serverState.deletedWatchLaterVideoIds]
  );
  const visiblePlaylistItems = useMemo(
    () => playlistVideos.filter((v) => !deletedWatchLaterSet.has(v.videoId)),
    [playlistVideos, deletedWatchLaterSet]
  );
  const removedPlaylistItems = useMemo(
    () => playlistVideos.filter((v) => deletedWatchLaterSet.has(v.videoId)),
    [playlistVideos, deletedWatchLaterSet]
  );

  const handleRemoveWatchLater = useCallback(
    (videoId: string, title?: string) => {
      sendCommand({
        type: 'REMOVE_WATCH_LATER',
        videoId
      });
      triggerFeedback(`Video Sonra İzle'den kaldırıldı${title ? `: ${title.slice(0, 24)}...` : ''}`);
    },
    [sendCommand]
  );

  const handleRestoreWatchLater = useCallback(
    (videoId: string, title?: string) => {
      sendCommand({
        type: 'RESTORE_WATCH_LATER',
        videoId
      });
      triggerFeedback(`Video listeye geri eklendi${title ? `: ${title.slice(0, 24)}...` : ''}`);
    },
    [sendCommand]
  );

  const handleClearRemovedWatchLater = useCallback(() => {
    sendCommand({
      type: 'CLEAR_REMOVED_WATCH_LATER'
    });
    triggerFeedback('Kaldırılan tüm videolar geri yüklendi');
  }, [sendCommand]);

  const detectedDirectVideoId = useMemo(
    () => extractYouTubeVideoId(searchInput),
    [searchInput]
  );

  const sendDirectVideoToTv = (rawUrlOrId: string) => {
    const videoId = extractYouTubeVideoId(rawUrlOrId);
    if (!videoId) return false;

    fetch(`/api/youtube/play?url=${encodeURIComponent(rawUrlOrId)}`).catch(() => {
      sendCommand({
        type: 'OPEN_YOUTUBE_EXTERNAL',
        target: 'video',
        queryOrVideoId: videoId
      });
    });

    triggerFeedback('Video yeni YouTube sekmesinde açıldı');
    setSearchInput('');
    setActiveTab('mouse');
    return true;
  };

  // Auto-play in 1 step if opened via /remote?play=<youtube-url> or /remote?url=<youtube-url>
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared =
      params.get('play') || params.get('url') || params.get('v') || params.get('text');
    if (shared && extractYouTubeVideoId(shared)) {
      sendDirectVideoToTv(shared);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handlePlayDirectLink = () => {
    if (!detectedDirectVideoId) return;
    sendDirectVideoToTv(detectedDirectVideoId);
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (!trimmed) return;

    // If user pasted a direct YouTube link and submitted, play it right away
    const directId = extractYouTubeVideoId(trimmed);
    if (directId) {
      handlePlayDirectLink();
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(trimmed)}`);
      const data = (await res.json()) as YouTubeSearchResponse;
      if (!data.ok) {
        setSearchResults([]);
        setSearchError({
          message: data.errorMessage ?? 'YouTube araması yapılamadı.',
          fallbackQuery: trimmed
        });
      } else {
        setSearchResults(data.results);
        if (data.results.length === 0) {
          setSearchError({
            message: 'Eşleşen gömülebilir YouTube videosu bulunamadı.',
            fallbackQuery: trimmed
          });
        }
      }
    } catch {
      setSearchError({
        message: 'TV sunucusuna ulaşılamadı. Wi-Fi bağlantınızı kontrol edin.',
        fallbackQuery: trimmed
      });
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectVideo = (video: YouTubeSearchResult) => {
    sendCommand({
      type: 'OPEN_YOUTUBE_EXTERNAL',
      target: 'video',
      queryOrVideoId: video.videoId
    });
    triggerFeedback(`TV'de Açıldı: ${video.title.slice(0, 28)}`);
  };

  const handleShortcutTap = (item: ShortcutItem) => {
    if (item.internalAction === 'youtube_home') {
      setActiveTab('youtube');
      return;
    }
    sendCommand({ type: 'OPEN_SHORTCUT', shortcutId: item.id });
    triggerFeedback(`TV'de Açıldı: ${item.name}`);
  };

  const platforms = serverState.shortcuts.filter(
    (s) => s.category === 'platform' && (remoteEditMode || !s.hidden)
  );
  const diziSites = serverState.shortcuts.filter(
    (s) => s.category === 'dizi_site' && (remoteEditMode || !s.hidden)
  );
  const bookmarks = serverState.shortcuts.filter(
    (s) => s.category === 'bookmark' && (remoteEditMode || !s.hidden)
  );
  const sections = (
    serverState.sections && serverState.sections.length > 0
      ? serverState.sections
      : DEFAULT_TV_SECTIONS
  ).filter((s) => s.id !== 'youtube_search');

  const filteredBookmarks = useMemo(() => {
    const q = bookmarkFilter.trim().toLowerCase();
    if (!q) return bookmarks;
    return bookmarks.filter(
      (b) => b.name.toLowerCase().includes(q) || b.subtitle.toLowerCase().includes(q)
    );
  }, [bookmarks, bookmarkFilter]);

  const isConnected = connectionStatus === 'connected';
  const launchWithAntigravity = Boolean(serverState.launchAntigravityConfigured);

  return (
    <div className="remote-shell">
      {/* Sticky iPhone Top Status Header */}
      <header className="remote-header">
        <div className="remote-header-top">
          <div className="remote-title-group">
            <span className="remote-app-icon">
              <Tv size={16} strokeWidth={2.2} />
            </span>
            <div className="remote-title-text">
              <h1 className="remote-title">TV Kumanda</h1>
              <span className="remote-subtitle">
                {serverState.tvConnectedCount > 0
                  ? `• TV Açık (${serverState.tvConnectedCount})`
                  : '• TV Kapalı'}
              </span>
            </div>
          </div>

          <div className="remote-header-actions">
            <button
              type="button"
              className="remote-theme-btn"
              onClick={() => {
                sendCommand({
                  type: 'LAUNCH_DESKTOP',
                  target: launchWithAntigravity ? 'all' : 'tv'
                });
                triggerFeedback(
                  launchWithAntigravity
                    ? 'Bilgisayarda TV & Antigravity açılıyor...'
                    : 'Bilgisayarda TV açılıyor...'
                );
              }}
              aria-label={
                launchWithAntigravity
                  ? "Bilgisayarda TV ve Antigravity'yi Başlat"
                  : "Bilgisayarda TV'yi Başlat"
              }
              title={
                launchWithAntigravity
                  ? "Bilgisayarda TV ve Antigravity'yi Başlat"
                  : "Bilgisayarda TV'yi Başlat"
              }
            >
              <Monitor size={15} strokeWidth={2.2} />
            </button>

            <button
              type="button"
              className="remote-theme-btn"
              onClick={toggleScheme}
              aria-label={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
              title={isDark ? 'Açık Tema' : 'Koyu Tema'}
            >
              {isDark ? <Sun size={15} strokeWidth={2.2} /> : <Moon size={15} strokeWidth={2.2} />}
            </button>

            <button
              type="button"
              className={`remote-conn-badge ${isConnected ? 'is-online' : 'is-offline'}`}
              onClick={reconnectNow}
            >
              <span className="remote-conn-dot" />
              <span>{isConnected ? 'Bağlı' : 'Bağlan'}</span>
            </button>
          </div>
        </div>

        {serverState.tvConnectedCount === 0 && (
          <div className="remote-launch-banner">
            <div className="remote-launch-info">
              <span className="remote-launch-icon">
                <Tv size={15} strokeWidth={2.2} />
              </span>
              <span>TV bağlı değil</span>
            </div>
            <button
              type="button"
              className="remote-launch-btn"
              onClick={() => {
                sendCommand({
                  type: 'LAUNCH_DESKTOP',
                  target: launchWithAntigravity ? 'all' : 'tv'
                });
                triggerFeedback(
                  launchWithAntigravity
                    ? 'Bilgisayarda TV & Antigravity açılıyor...'
                    : 'Bilgisayarda TV açılıyor...'
                );
              }}
            >
              <Monitor size={14} strokeWidth={2.2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} />
              {launchWithAntigravity ? 'TV & Antigravity Aç' : "TV'yi Aç"}
            </button>
          </div>
        )}

        {feedbackToast && <div className="remote-toast">{feedbackToast}</div>}

        {/* Now Playing Mini Bar */}
        {serverState.nowPlaying && (
          <div className="remote-now-playing">
            <div className="remote-np-info">
              <span className="remote-np-status">
                {STATUS_LABELS[serverState.playerStatus] ?? serverState.playerStatus}
              </span>
              <strong className="remote-np-title">{serverState.nowPlaying.title}</strong>
            </div>
            <div className="remote-np-actions">
              <button
                type="button"
                className="remote-np-btn"
                onClick={() => sendCommand({ type: 'COMMAND', action: 'TOGGLE_PLAY' })}
              >
                {serverState.playerStatus === 'playing' ? (
                  <>
                    <Pause size={13} strokeWidth={2.2} fill="currentColor" /> Duraklat
                  </>
                ) : (
                  <>
                    <Play size={13} strokeWidth={2.2} fill="currentColor" /> Oynat
                  </>
                )}
              </button>
              <button
                type="button"
                className="remote-np-btn remote-np-btn-ext"
                title="YouTube Sekmesinde Aç"
                onClick={() =>
                  sendCommand({
                    type: 'OPEN_YOUTUBE_EXTERNAL',
                    target: 'video',
                    queryOrVideoId: serverState.nowPlaying!.videoId
                  })
                }
              >
                <ExternalLink size={13} strokeWidth={2.2} /> Sekme
              </button>
              {visiblePlaylistItems.some((v) => v.videoId === serverState.nowPlaying?.videoId) && (
                <button
                  type="button"
                  className="remote-np-btn"
                  title="Sonra İzle Listesinden Kaldır"
                  onClick={() =>
                    handleRemoveWatchLater(
                      serverState.nowPlaying!.videoId,
                      serverState.nowPlaying!.title
                    )
                  }
                >
                  <Trash2 size={13} strokeWidth={2.2} /> Kaldır
                </button>
              )}
            </div>
          </div>
        )}

        {/* Unavailable / Non-Embeddable Error Banner on iPhone */}
        {serverState.playerStatus === 'error' && serverState.nowPlaying && (
          <div className="remote-error-banner" role="alert">
            <p>
              <strong>Gömülü Oynatma Kısıtlı:</strong>{' '}
              {serverState.playerErrorMessage ??
                'Bu video uygulama içinde oynatılamıyor.'}
            </p>
            <button
              type="button"
              className="remote-btn remote-btn-accent remote-btn-full"
              onClick={() =>
                sendCommand({
                  type: 'OPEN_YOUTUBE_EXTERNAL',
                  target: 'video',
                  queryOrVideoId: serverState.nowPlaying!.videoId
                })
              }
            >
              <ExternalLink size={15} strokeWidth={2.2} /> Videoyu TV'de YouTube Sekmesinde Aç
            </button>
          </div>
        )}
      </header>

      {/* Main Scrollable Tab Body */}
      <main className="remote-body">
        {activeTab === 'controls' && (
          <div className="remote-tab-pane">
            {/* Top Quick Actions */}
            <div className="remote-quick-row">
              <button
                type="button"
                className="remote-action-btn"
                onClick={() => {
                  sendCommand({ type: 'COMMAND', action: 'GO_HOME' });
                  triggerFeedback('Ana Ekran');
                }}
              >
                <span className="remote-action-icon">
                  <Home size={22} strokeWidth={2.2} />
                </span>
                <span>Ana Ekran</span>
              </button>

              <button
                type="button"
                className="remote-action-btn"
                onClick={() => {
                  sendCommand({ type: 'COMMAND', action: 'GO_BACK' });
                  triggerFeedback('Geri');
                }}
              >
                <span className="remote-action-icon">
                  <Undo2 size={22} strokeWidth={2.2} />
                </span>
                <span>Geri</span>
              </button>

              <button
                type="button"
                className="remote-action-btn remote-action-primary"
                onClick={() => {
                  sendCommand({ type: 'COMMAND', action: 'TOGGLE_PLAY' });
                  triggerFeedback('Oynat / Duraklat');
                }}
              >
                <span className="remote-action-icon">
                  {serverState.playerStatus === 'playing' ? (
                    <Pause size={22} strokeWidth={2.2} fill="currentColor" />
                  ) : (
                    <Play size={22} strokeWidth={2.2} fill="currentColor" />
                  )}
                </span>
                <span>Oynat/Durdur</span>
              </button>

              <button
                type="button"
                className={`remote-action-btn ${serverState.muted ? 'is-active-danger' : ''}`}
                onClick={() => {
                  sendCommand({ type: 'COMMAND', action: 'TOGGLE_MUTE' });
                  triggerFeedback(serverState.muted ? 'Ses Açıldı' : 'Sessize Alındı');
                }}
              >
                <span className="remote-action-icon">
                  {serverState.muted ? (
                    <VolumeX size={22} strokeWidth={2.2} />
                  ) : (
                    <Volume2 size={22} strokeWidth={2.2} />
                  )}
                </span>
                <span>{serverState.muted ? 'Sesi Aç' : 'Sessiz'}</span>
              </button>
            </div>

            {/* Active TV Episode / Save Progress Prompt */}
            {serverState.activeTabCandidate && (
              <div className="remote-active-tab-card">
                <div className="remote-active-tab-header">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <Tv size={16} strokeWidth={2.2} />
                    TV'de Açık Dizi
                  </span>
                  <span>Canlı</span>
                </div>
                <div className="remote-active-tab-title">
                  {serverState.activeTabCandidate.title || serverState.activeTabCandidate.url}
                </div>
                <button
                  type="button"
                  className="remote-btn remote-btn-accent remote-btn-full"
                  onClick={() => {
                    sendCommand({
                      type: 'SAVE_PROGRESS',
                      url: serverState.activeTabCandidate!.url,
                      title: serverState.activeTabCandidate!.title
                    });
                    triggerFeedback('Kaldığın yer kaydedildi!');
                  }}
                >
                  <BookmarkCheck size={16} strokeWidth={2.2} /> Kaldığım Yeri Kaydet
                </button>
              </div>
            )}

            {/* D-Pad Spatial Navigation Controller */}
            <div className="remote-dpad-card">
              <div className="remote-card-label">TV Ekranı Yönlendirme (D-Pad)</div>
              <div className="remote-dpad-grid">
                <div />
                <button
                  type="button"
                  className="remote-dpad-btn"
                  aria-label="Yukarı"
                  onClick={() => sendCommand({ type: 'NAVIGATE', direction: 'UP' })}
                >
                  <ChevronUp size={28} strokeWidth={2.5} />
                </button>
                <div />

                <button
                  type="button"
                  className="remote-dpad-btn"
                  aria-label="Sol"
                  onClick={() => sendCommand({ type: 'NAVIGATE', direction: 'LEFT' })}
                >
                  <ChevronLeft size={28} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  className="remote-dpad-btn remote-dpad-ok"
                  aria-label="Seç (OK)"
                  onClick={() => {
                    sendCommand({ type: 'NAVIGATE', direction: 'SELECT' });
                    triggerFeedback('Seçildi (OK)');
                  }}
                >
                  OK
                </button>
                <button
                  type="button"
                  className="remote-dpad-btn"
                  aria-label="Sağ"
                  onClick={() => sendCommand({ type: 'NAVIGATE', direction: 'RIGHT' })}
                >
                  <ChevronRight size={28} strokeWidth={2.5} />
                </button>

                <div />
                <button
                  type="button"
                  className="remote-dpad-btn"
                  aria-label="Aşağı"
                  onClick={() => sendCommand({ type: 'NAVIGATE', direction: 'DOWN' })}
                >
                  <ChevronDown size={28} strokeWidth={2.5} />
                </button>
                <div />
              </div>
            </div>

            {/* Volume Controls */}
            <div className="remote-volume-card">
              <div className="remote-volume-header">
                <span>TV / Bilgisayar Ses Seviyesi</span>
                <strong>{serverState.muted ? 'Sessiz (Mute)' : `%${serverState.volume}`}</strong>
              </div>

              <input
                type="range"
                min={0}
                max={100}
                value={serverState.volume}
                className="remote-volume-slider"
                aria-label="Ses Seviyesi"
                onChange={(e) =>
                  sendCommand({
                    type: 'SET_VOLUME',
                    volume: Number(e.target.value)
                  })
                }
              />

              <div className="remote-volume-buttons">
                <button
                  type="button"
                  className="remote-btn remote-btn-secondary"
                  onClick={() => sendCommand({ type: 'ADJUST_VOLUME', delta: -10 })}
                >
                  <Volume1 size={16} strokeWidth={2} /> Ses -10
                </button>
                <button
                  type="button"
                  className="remote-btn remote-btn-secondary"
                  onClick={() => sendCommand({ type: 'COMMAND', action: 'TOGGLE_MUTE' })}
                >
                  {serverState.muted ? (
                    <>
                      <Volume2 size={16} strokeWidth={2} /> Sesi Aç
                    </>
                  ) : (
                    <>
                      <VolumeX size={16} strokeWidth={2} /> Sessiz
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="remote-btn remote-btn-secondary"
                  onClick={() => sendCommand({ type: 'ADJUST_VOLUME', delta: 10 })}
                >
                  <Volume2 size={16} strokeWidth={2} /> Ses +10
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mouse' && (
          <div className="remote-tab-pane remote-tab-pane-mouse">
            <TouchpadView
              sendCommand={sendCommand}
              triggerFeedback={triggerFeedback}
              activeSeriesTitle={serverState.activeTabCandidate?.title}
              isMuted={serverState.muted}
            />
          </div>
        )}

        {activeTab === 'youtube' && (
          <div className="remote-tab-pane">
            <form className="remote-search-form" onSubmit={handleSearchSubmit}>
              <input
                type="search"
                className="remote-search-input"
                placeholder="YouTube'da ara veya link yapıştır (anında açılır)..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData?.getData('text') ?? '';
                  if (pasted && extractYouTubeVideoId(pasted)) {
                    e.preventDefault();
                    sendDirectVideoToTv(pasted);
                  }
                }}
                enterKeyHint="search"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              <button
                type="submit"
                className="remote-btn remote-btn-accent"
                disabled={searchLoading}
              >
                {searchLoading ? (
                  '...'
                ) : detectedDirectVideoId ? (
                  <>
                    <Play size={14} strokeWidth={2.2} fill="currentColor" /> Oynat
                  </>
                ) : (
                  <>
                    <Search size={15} strokeWidth={2.2} /> Ara
                  </>
                )}
              </button>
            </form>

            {/* Instant Play button if input is typed manually as a direct YouTube URL or 11-char ID */}
            {detectedDirectVideoId && (
              <div className="remote-direct-link-card">
                <p style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Film size={16} strokeWidth={2.2} /> Doğrudan YouTube video bağlantısı algılandı ({detectedDirectVideoId})
                </p>
                <button
                  type="button"
                  className="remote-btn remote-btn-accent remote-btn-full"
                  onClick={handlePlayDirectLink}
                >
                  <Play size={14} strokeWidth={2.2} fill="currentColor" /> Aç
                </button>
              </div>
            )}

            {/* Quick button to open search directly in TV Browser */}
            {searchInput.trim() && !detectedDirectVideoId && (
              <button
                type="button"
                className="remote-btn remote-btn-secondary remote-btn-full remote-ext-search-btn"
                onClick={() => {
                  sendCommand({
                    type: 'OPEN_YOUTUBE_EXTERNAL',
                    target: 'search',
                    queryOrVideoId: searchInput.trim()
                  });
                  triggerFeedback('Arama TV tarayıcısında açıldı');
                }}
              >
                <ExternalLink size={15} strokeWidth={2.2} /> "{searchInput.trim().slice(0, 24)}" Aramasını TV YouTube Sekmesinde Aç
              </button>
            )}

            {searchError && (
              <div className="remote-alert-box" role="alert">
                <p>{searchError.message}</p>
                <button
                  type="button"
                  className="remote-btn remote-btn-accent remote-btn-full"
                  onClick={() => {
                    sendCommand({
                      type: 'OPEN_YOUTUBE_EXTERNAL',
                      target: 'search',
                      queryOrVideoId: searchError.fallbackQuery
                    });
                    triggerFeedback('YouTube araması TV sekmesinde açıldı');
                  }}
                >
                  <ExternalLink size={15} strokeWidth={2.2} /> Arama Sonuçlarını TV Tarayıcısında Aç
                </button>
              </div>
            )}

            {searchLoading && (
              <div className="remote-empty-state">YouTube videoları aranıyor...</div>
            )}

            {searchResults.length === 0 && !searchLoading && !searchError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.6rem',
                  margin: '0.8rem 0 0.5rem',
                  flexWrap: 'wrap'
                }}
              >
                <h3 className="remote-section-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={16} strokeWidth={2.2} /> Sonra İzle {visiblePlaylistItems.length > 0 ? `(${visiblePlaylistItems.length})` : ''}
                </h3>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {removedPlaylistItems.length > 0 && (
                    <button
                      type="button"
                      className={`remote-btn remote-btn-sm ${showRemovedWatchLater ? 'remote-btn-accent' : 'remote-btn-secondary'}`}
                      onClick={() => setShowRemovedWatchLater((prev) => !prev)}
                      title="Kaldırılan videoları göster"
                    >
                      <Trash2 size={13} strokeWidth={2} /> Kaldırılanlar ({removedPlaylistItems.length})
                    </button>
                  )}
                  {playlistId && (
                    <button
                      type="button"
                      className="remote-btn remote-btn-secondary remote-btn-sm"
                      onClick={() => {
                        window.open(`https://www.youtube.com/playlist?list=${playlistId}`, '_blank');
                        triggerFeedback("YouTube'da açılıyor");
                      }}
                      title="YouTube'da Listeyi Aç ve Yönet"
                    >
                      <ExternalLink size={13} strokeWidth={2} /> YouTube'da Aç
                    </button>
                  )}
                  <button
                    type="button"
                    className="remote-btn remote-btn-secondary remote-btn-sm"
                    onClick={() => loadPlaylist(true)}
                    disabled={playlistRefreshing}
                    title="Listeyi YouTube'dan Yenile"
                  >
                    <RotateCw size={13} strokeWidth={2} className={playlistRefreshing ? 'remote-spin' : ''} />
                    {playlistRefreshing ? 'Yenileniyor...' : 'Yenile'}
                  </button>
                </div>
              </div>
            )}

            {showRemovedWatchLater && removedPlaylistItems.length > 0 && (
              <div className="remote-removed-drawer">
                <div className="remote-removed-header">
                  <span>Kaldırılan Videolar ({removedPlaylistItems.length})</span>
                  <button
                    type="button"
                    className="remote-btn remote-btn-secondary remote-btn-sm"
                    onClick={handleClearRemovedWatchLater}
                  >
                    Tümünü Geri Al
                  </button>
                </div>
                <div className="remote-removed-list">
                  {removedPlaylistItems.map((video) => (
                    <div key={video.videoId} className="remote-removed-item">
                      <span className="remote-removed-title" title={video.title}>
                        {video.title}
                      </span>
                      <button
                        type="button"
                        className="remote-btn remote-btn-secondary remote-btn-sm"
                        onClick={() => handleRestoreWatchLater(video.videoId, video.title)}
                        title="Listeye geri ekle"
                      >
                        <Undo2 size={13} strokeWidth={2} /> Geri Al
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {searchResults.length === 0 && !searchLoading && !searchError && playlistError && (
              <div className="remote-empty-state">{playlistError}</div>
            )}

            {searchResults.length === 0 &&
              !searchLoading &&
              !searchError &&
              visiblePlaylistItems.length === 0 &&
              !playlistError && (
                <div className="remote-empty-state">
                  {removedPlaylistItems.length > 0
                    ? 'Tüm videolar listeden kaldırıldı. Yukarıdaki "Kaldırılanlar" butonundan geri alabilirsiniz.'
                    : 'Sonra İzle listesinde video bulunmuyor.'}
                </div>
              )}

            <div className="remote-results-list">
              {(searchResults.length > 0 || searchLoading || searchError
                ? searchResults
                : visiblePlaylistItems
              ).map((video) => {
                const isWatchLaterItem =
                  searchResults.length === 0 && !searchLoading && !searchError;
                return (
                  <div key={video.videoId} className="remote-video-item">
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="remote-video-thumb"
                      loading="lazy"
                      onClick={() => handleSelectVideo(video)}
                    />
                    <div className="remote-video-info">
                      <h3
                        className="remote-video-title"
                        onClick={() => handleSelectVideo(video)}
                      >
                        {video.title}
                      </h3>
                      <span className="remote-video-channel">{video.channelTitle}</span>
                      <div className="remote-video-actions">
                        <button
                          type="button"
                          className="remote-btn remote-btn-accent remote-btn-sm"
                          onClick={() => handleSelectVideo(video)}
                        >
                          <Play size={13} strokeWidth={2.2} fill="currentColor" /> Aç
                        </button>
                        {isWatchLaterItem && (
                          <button
                            type="button"
                            className="remote-btn remote-btn-danger remote-btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveWatchLater(video.videoId, video.title);
                            }}
                            title="Sonra İzle Listesinden Kaldır"
                          >
                            <Trash2 size={13} strokeWidth={2} /> Kaldır
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* iOS Share Sheet Shortcut Setup Helper (discreetly placed at bottom) */}
            {isShareSetupDismissed ? (
              <div className="remote-share-setup-hidden-footer">
                <button
                  type="button"
                  className="remote-btn-text-muted"
                  onClick={() => {
                    setIsShareSetupDismissed(false);
                    try {
                      localStorage.removeItem('tv_hide_share_setup');
                    } catch {}
                  }}
                >
                  <Sparkles size={12} strokeWidth={2} /> iPhone Paylaşım Kestirmesi Kurulumunu Göster
                </button>
              </div>
            ) : (
              <details className="remote-share-setup-details">
                <summary className="remote-share-setup-summary">
                  <span className="remote-share-setup-title">
                    <Sparkles size={14} strokeWidth={2.2} />
                    <span>iPhone YouTube "Paylaş" Kestirmesi (Kurulum)</span>
                  </span>
                  <ChevronDown size={14} strokeWidth={2.2} className="remote-details-chevron" />
                </summary>
                <div className="remote-share-setup-body">
                  <p style={{ margin: 0 }}>
                    <strong>iOS Kestirmeler (Shortcuts)</strong> uygulamasında{' '}
                    <em>"Paylaşım Sayfasında Göster"</em> açık yeni bir kestirme oluşturup tek işlem
                    olarak <strong>"URL İçeriğini Al" (Get Contents of URL)</strong> ekleyin ve
                    adresi şu şekilde yapıştırıp sonuna <strong>Kestirme Girişi</strong> ekleyin:
                  </p>
                  <code className="remote-share-setup-code">
                    {(serverState.lanUrls[0]?.replace(/\/remote$/, '') || window.location.origin) +
                      '/api/youtube/play?url='}
                  </code>
                  <div className="remote-share-setup-actions">
                    <button
                      type="button"
                      className="remote-btn remote-btn-accent remote-btn-sm"
                      onClick={() => {
                        const base =
                          serverState.lanUrls[0]?.replace(/\/remote$/, '') || window.location.origin;
                        const endpointUrl = `${base}/api/youtube/play?url=`;
                        navigator.clipboard?.writeText(endpointUrl).then(
                          () => triggerFeedback('Kestirme adresi panoya kopyalandı'),
                          () => triggerFeedback(endpointUrl)
                        );
                      }}
                    >
                      Kestirme Adresini Kopyala
                    </button>
                    <button
                      type="button"
                      className="remote-btn remote-btn-secondary remote-btn-sm"
                      onClick={() => {
                        setIsShareSetupDismissed(true);
                        try {
                          localStorage.setItem('tv_hide_share_setup', 'true');
                        } catch {}
                        triggerFeedback('Kurulum kutusu gizlendi');
                      }}
                    >
                      <Check size={13} strokeWidth={2.2} /> Kurulumu Yaptım, Gizle
                    </button>
                  </div>
                </div>
              </details>
            )}
          </div>
        )}

        {activeTab === 'media' && (
          <div className="remote-tab-pane">
            {/* Segmented Control for Platforms & Bookmarks */}
            <div className="remote-segmented-control" role="tablist" aria-label="İçerik Görünümü">
              <button
                type="button"
                role="tab"
                aria-selected={mediaSubTab === 'bookmarks'}
                className={`remote-segment-btn ${mediaSubTab === 'bookmarks' ? 'is-active' : ''}`}
                onClick={() => setMediaSubTab('bookmarks')}
              >
                <Bookmark size={15} strokeWidth={2.2} />
                <span>Kayıtlı Diziler</span>
                {bookmarks.length > 0 && (
                  <span className="remote-segment-badge">{bookmarks.length}</span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mediaSubTab === 'platforms'}
                className={`remote-segment-btn ${mediaSubTab === 'platforms' ? 'is-active' : ''}`}
                onClick={() => setMediaSubTab('platforms')}
              >
                <LayoutGrid size={15} strokeWidth={2.2} />
                <span>Platformlar</span>
              </button>
            </div>

            {mediaSubTab === 'platforms' && (
              <>
                <div className="remote-edit-bar">
              <button
                type="button"
                className={`remote-btn remote-btn-sm ${
                  remoteEditMode ? 'remote-btn-accent' : 'remote-btn-secondary'
                }`}
                onClick={() => setRemoteEditMode((prev) => !prev)}
              >
                {remoteEditMode ? (
                  <>
                    <Check size={14} strokeWidth={2.5} /> Düzenlemeyi Bitir
                  </>
                ) : (
                  <>
                    <SlidersHorizontal size={14} strokeWidth={2} /> Sırala / Gizle / Sil
                  </>
                )}
              </button>
              {remoteEditMode && (
                <button
                  type="button"
                  className="remote-btn remote-btn-sm remote-btn-secondary"
                  onClick={() => {
                    sendCommand({ type: 'RESET_LAYOUT' });
                    triggerFeedback('Varsayılan düzene sıfırlandı');
                  }}
                >
                  <RotateCcw size={14} strokeWidth={2} /> Sıfırla
                </button>
              )}
            </div>

            {remoteEditMode && (
              <div className="remote-sections-editor">
                <h3 className="remote-section-heading">TV Ana Ekran Sekmeleri</h3>
                {sections.map((sec, idx) => (
                  <div
                    key={sec.id}
                    className={`remote-section-edit-row ${sec.hidden ? 'is-hidden' : ''}`}
                  >
                    <span className="remote-section-edit-title">
                      {idx + 1}. {sec.title}
                    </span>
                    <div className="remote-item-edit-btns">
                      <button
                        type="button"
                        className="remote-mini-btn"
                        disabled={idx === 0}
                        onClick={() =>
                          sendCommand({
                            type: 'REORDER_SECTION',
                            sectionId: sec.id,
                            direction: 'UP'
                          })
                        }
                      >
                        <ChevronUp size={14} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn"
                        disabled={idx === sections.length - 1}
                        onClick={() =>
                          sendCommand({
                            type: 'REORDER_SECTION',
                            sectionId: sec.id,
                            direction: 'DOWN'
                          })
                        }
                      >
                        <ChevronDown size={14} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn"
                        onClick={() =>
                          sendCommand({
                            type: 'TOGGLE_SECTION_HIDDEN',
                            sectionId: sec.id,
                            hidden: !sec.hidden
                          })
                        }
                      >
                        {sec.hidden ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h2 className="remote-section-heading">Yayın Platformları</h2>
            <div className="remote-shortcut-grid">
              {platforms.map((item, idx) => {
                const iconSrc = item.imageUrl || resolveShortcutIconUrl(item.id, item.url);
                return (
                <div
                  key={item.id}
                  className={`remote-shortcut-card-wrap ${item.hidden ? 'is-hidden' : ''}`}
                >
                  <button
                    type="button"
                    className="remote-shortcut-btn"
                    style={{ '--btn-accent': item.color } as React.CSSProperties}
                    onClick={() => handleShortcutTap(item)}
                  >
                    <span className="remote-shortcut-badge">
                      {iconSrc ? (
                        <img
                          src={iconSrc}
                          alt=""
                          className="remote-shortcut-icon-img"
                          loading="lazy"
                        />
                      ) : (
                        item.badge
                      )}
                    </span>
                    <div className="remote-shortcut-text">
                      <strong>
                        {item.name} {item.hidden ? '(Gizli)' : ''}
                      </strong>
                      {item.subtitle && <small>{item.subtitle}</small>}
                    </div>
                  </button>
                  {remoteEditMode && (
                    <div className="remote-item-edit-btns">
                      <button
                        type="button"
                        className="remote-mini-btn"
                        disabled={idx === 0 || Boolean(item.hidden)}
                        onClick={() =>
                          sendCommand({
                            type: 'REORDER_SHORTCUT',
                            shortcutId: item.id,
                            direction: 'PREV'
                          })
                        }
                      >
                        <ChevronLeft size={14} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn"
                        disabled={idx === platforms.length - 1 || Boolean(item.hidden)}
                        onClick={() =>
                          sendCommand({
                            type: 'REORDER_SHORTCUT',
                            shortcutId: item.id,
                            direction: 'NEXT'
                          })
                        }
                      >
                        <ChevronRight size={14} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn"
                        onClick={() =>
                          sendCommand({
                            type: 'TOGGLE_SHORTCUT_HIDDEN',
                            shortcutId: item.id,
                            hidden: !item.hidden
                          })
                        }
                      >
                        {item.hidden ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn remote-mini-btn-danger"
                        onClick={() =>
                          sendCommand({
                            type: 'DELETE_SHORTCUT',
                            shortcutId: item.id
                          })
                        }
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>

            <h2 className="remote-section-heading">Favori Dizi & Film Siteleri</h2>
            <div className="remote-shortcut-grid">
              {diziSites.map((item, idx) => {
                const iconSrc = item.imageUrl || resolveShortcutIconUrl(item.id, item.url);
                return (
                <div
                  key={item.id}
                  className={`remote-shortcut-card-wrap ${item.hidden ? 'is-hidden' : ''}`}
                >
                  <button
                    type="button"
                    className="remote-shortcut-btn"
                    style={{ '--btn-accent': item.color } as React.CSSProperties}
                    onClick={() => handleShortcutTap(item)}
                  >
                    <span className="remote-shortcut-badge">
                      {iconSrc ? (
                        <img
                          src={iconSrc}
                          alt=""
                          className="remote-shortcut-icon-img"
                          loading="lazy"
                        />
                      ) : (
                        item.badge
                      )}
                    </span>
                    <div className="remote-shortcut-text">
                      <strong>
                        {item.name} {item.hidden ? '(Gizli)' : ''}
                      </strong>
                      {item.subtitle && <small>{item.subtitle}</small>}
                    </div>
                  </button>
                  {remoteEditMode && (
                    <div className="remote-item-edit-btns">
                      <button
                        type="button"
                        className="remote-mini-btn"
                        disabled={idx === 0 || Boolean(item.hidden)}
                        onClick={() =>
                          sendCommand({
                            type: 'REORDER_SHORTCUT',
                            shortcutId: item.id,
                            direction: 'PREV'
                          })
                        }
                      >
                        <ChevronLeft size={14} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn"
                        disabled={idx === diziSites.length - 1 || Boolean(item.hidden)}
                        onClick={() =>
                          sendCommand({
                            type: 'REORDER_SHORTCUT',
                            shortcutId: item.id,
                            direction: 'NEXT'
                          })
                        }
                      >
                        <ChevronRight size={14} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn"
                        onClick={() =>
                          sendCommand({
                            type: 'TOGGLE_SHORTCUT_HIDDEN',
                            shortcutId: item.id,
                            hidden: !item.hidden
                          })
                        }
                      >
                        {item.hidden ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn remote-mini-btn-danger"
                        onClick={() =>
                          sendCommand({
                            type: 'DELETE_SHORTCUT',
                            shortcutId: item.id
                          })
                        }
                      >
                        <Trash2 size={14} strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
              </>
            )}

            {mediaSubTab === 'bookmarks' && (
              <>
                {/* Active TV Episode / Save Progress Prompt in Bookmarks Tab */}
            {serverState.activeTabCandidate && (
              <div className="remote-active-tab-card">
                <div className="remote-active-tab-header">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <Tv size={16} strokeWidth={2.2} /> TV'de Açık Dizi Algılandı
                  </span>
                  <span>Canlı</span>
                </div>
                <div className="remote-active-tab-title">
                  {serverState.activeTabCandidate.title || serverState.activeTabCandidate.url}
                </div>
                <button
                  type="button"
                  className="remote-btn remote-btn-accent remote-btn-full"
                  onClick={() => {
                    sendCommand({
                      type: 'SAVE_PROGRESS',
                      url: serverState.activeTabCandidate!.url,
                      title: serverState.activeTabCandidate!.title
                    });
                    triggerFeedback('Kaldığın yer kaydedildi!');
                  }}
                >
                  <BookmarkCheck size={16} strokeWidth={2.2} /> Kaldığım Yeri Kaydet
                </button>
              </div>
            )}

            <div className="remote-edit-bar">
              <button
                type="button"
                className={`remote-btn remote-btn-sm ${
                  remoteEditMode ? 'remote-btn-accent' : 'remote-btn-secondary'
                }`}
                onClick={() => setRemoteEditMode((prev) => !prev)}
              >
                {remoteEditMode ? (
                  <>
                    <Check size={14} strokeWidth={2.5} /> Düzenlemeyi Bitir
                  </>
                ) : (
                  <>
                    <SlidersHorizontal size={14} strokeWidth={2} /> Sırala / Gizle / Sil
                  </>
                )}
              </button>
              {remoteEditMode && (
                <button
                  type="button"
                  className="remote-btn remote-btn-sm remote-btn-secondary"
                  onClick={() => {
                    sendCommand({ type: 'RESET_LAYOUT' });
                    triggerFeedback('Varsayılan düzene sıfırlandı');
                  }}
                >
                  <RotateCcw size={14} strokeWidth={2} /> Sıfırla
                </button>
              )}
            </div>

            <input
              type="search"
              className="remote-search-input remote-bookmark-filter"
              placeholder="Kayıtlı bölümlerde filtrele (örn. Seinfeld, Friends, Death Note)..."
              value={bookmarkFilter}
              onChange={(e) => setBookmarkFilter(e.target.value)}
              enterKeyHint="search"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />

            <div className="remote-bookmark-list">
              {filteredBookmarks.map((item, idx) => (
                <div
                  key={item.id}
                  className={`remote-bookmark-row-wrap ${item.hidden ? 'is-hidden' : ''}`}
                >
                  <div className="remote-bookmark-row-top">
                    <button
                      type="button"
                      className="remote-bookmark-item"
                      style={{ '--btn-accent': item.color } as React.CSSProperties}
                      onClick={() => handleShortcutTap(item)}
                    >
                      <img
                        src={
                          item.imageUrl ||
                          `/api/series-poster?q=${encodeURIComponent(item.name)}`
                        }
                        alt={item.name}
                        className="remote-series-thumb"
                        loading="lazy"
                      />
                      <div className="remote-bookmark-text">
                        <strong>
                          {item.name} {item.hidden ? '(Gizli)' : ''}
                        </strong>
                        {item.subtitle && <small>{item.subtitle}</small>}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="remote-advance-btn"
                      title="Sonraki bölüme ilerlet (+1)"
                      onClick={() => {
                        const seriesKey = item.id.replace(/^bm-series-/, '');
                        sendCommand({ type: 'ADVANCE_PROGRESS', key: seriesKey });
                        triggerFeedback(`${item.name}: Sonraki bölüme ilerletildi (+1)`);
                      }}
                    >
                      <Plus size={13} strokeWidth={2.5} /> 1 Bölüm
                    </button>
                  </div>
                  {remoteEditMode && (
                    <div className="remote-item-edit-btns">
                      <button
                        type="button"
                        className="remote-mini-btn"
                        disabled={idx === 0 || Boolean(item.hidden)}
                        onClick={() =>
                          sendCommand({
                            type: 'REORDER_SHORTCUT',
                            shortcutId: item.id,
                            direction: 'PREV'
                          })
                        }
                      >
                        <ChevronUp size={14} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn"
                        disabled={idx === filteredBookmarks.length - 1 || Boolean(item.hidden)}
                        onClick={() =>
                          sendCommand({
                            type: 'REORDER_SHORTCUT',
                            shortcutId: item.id,
                            direction: 'NEXT'
                          })
                        }
                      >
                        <ChevronDown size={14} strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn"
                        onClick={() =>
                          sendCommand({
                            type: 'TOGGLE_SHORTCUT_HIDDEN',
                            shortcutId: item.id,
                            hidden: !item.hidden
                          })
                        }
                      >
                        {item.hidden ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
                      </button>
                      <button
                        type="button"
                        className="remote-mini-btn remote-mini-btn-danger"
                        onClick={() =>
                          sendCommand({
                            type: 'DELETE_SHORTCUT',
                            shortcutId: item.id
                          })
                        }
                      >
                        <Trash2 size={14} strokeWidth={2} /> Sil
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Bottom Thumb Navigation Bar */}
      <nav className="remote-bottom-nav" aria-label="Kumanda Sekmeleri">
        <button
          type="button"
          className={`remote-nav-tab ${activeTab === 'mouse' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('mouse')}
        >
          <span className="remote-nav-icon">
            <Mouse size={20} strokeWidth={activeTab === 'mouse' ? 2.4 : 2} />
          </span>
          <span>Mouse</span>
        </button>

        <button
          type="button"
          className={`remote-nav-tab ${activeTab === 'youtube' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('youtube')}
        >
          <span className="remote-nav-icon">
            <YouTubeIcon size={20} />
          </span>
          <span>YouTube</span>
        </button>

        <button
          type="button"
          className={`remote-nav-tab ${activeTab === 'media' ? 'is-active' : ''}`}
          onClick={() => {
            setActiveTab('media');
            setMediaSubTab('bookmarks');
          }}
        >
          <span className="remote-nav-icon">
            <Clapperboard size={20} strokeWidth={activeTab === 'media' ? 2.4 : 2} />
          </span>
          <span>Dizi & Medya</span>
        </button>

        <button
          type="button"
          className={`remote-nav-tab ${activeTab === 'controls' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('controls')}
        >
          <span className="remote-nav-icon">
            <Gamepad2 size={20} strokeWidth={activeTab === 'controls' ? 2.4 : 2} />
          </span>
          <span>Kumanda</span>
        </button>
      </nav>
    </div>
  );
}
