import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useWsClient } from '../hooks/useWsClient.js';
import { useThemeScheme } from '../hooks/useThemeScheme.js';
import {
  applyRovingTabIndex,
  getSpatialCandidates,
  isEditableControl,
  performSpatialNavigation
} from '../utils/spatialNavigation.js';
import { YouTubePlayerView, type YouTubePlayerHandle } from './YouTubePlayerView.js';
import { buildSafeYouTubeExternalUrl } from '../../shared/protocol.js';
import { DEFAULT_TV_SECTIONS } from '../../shared/shortcuts.js';
import { resolveShortcutIconUrl } from '../../shared/platformIcons.js';
import type {
  ShortcutCategory,
  ShortcutItem,
  TVSectionConfig,
  TVSectionId,
  ValidatedClientMessage,
  YouTubeSearchResult
} from '../../shared/types.js';

interface HealthInfo {
  primaryRemoteUrl: string;
  lanRemoteUrls: string[];
  qrCodeDataUrl: string | null;
  youtubeApiConfigured: boolean;
}

type ScopedTransitionElement = HTMLElement & {
  startViewTransition?: (callback: () => void) => {
    ready: Promise<void>;
  };
};

/**
 * Modern Web Guidance (scoped-component-transitions):
 * Runs a DOM update inside an element-scoped view transition when supported,
 * degrading gracefully to an immediate update on browsers without Element.prototype.startViewTransition.
 */
function runWithScopedTransition(scopeEl: HTMLElement | null, updateDOM: () => void): void {
  const el = scopeEl as ScopedTransitionElement | null;
  if (!el || typeof el.startViewTransition !== 'function') {
    updateDOM();
    return;
  }
  const transition = el.startViewTransition(() => {
    flushSync(() => {
      updateDOM();
    });
  });
  transition.ready.catch(() => {});
}

export function TVApp() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const homeMainRef = useRef<HTMLElement | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const playerHandleRef = useRef<YouTubePlayerHandle | null>(null);
  const qrDialogRef = useRef<HTMLDialogElement | null>(null);
  const addDialogRef = useRef<HTMLDialogElement | null>(null);

  const [clockText, setClockText] = useState<string>('');
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const { isDark, toggleScheme } = useThemeScheme();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [blockedPopupUrl, setBlockedPopupUrl] = useState<{ name: string; url: string } | null>(
    null
  );

  // TV UI Edit/Customize Mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [draggedShortcutId, setDraggedShortcutId] = useState<string | null>(null);
  const [dragOverShortcutId, setDragOverShortcutId] = useState<string | null>(null);

  // Add New Shortcut Modal form state
  const [newAppName, setNewAppName] = useState('');
  const [newAppUrl, setNewAppUrl] = useState('https://');
  const [newAppCategory, setNewAppCategory] = useState<ShortcutCategory>('bookmark');
  const [newAppSubtitle, setNewAppSubtitle] = useState('');
  const [newAppColor, setNewAppColor] = useState('#3b6b82');

  // Watch Later (YouTube Playlist) state
  const [watchLaterVideos, setWatchLaterVideos] = useState<YouTubeSearchResult[]>([]);
  const [watchLaterLoading, setWatchLaterLoading] = useState(true);
  const [watchLaterRefreshing, setWatchLaterRefreshing] = useState(false);
  const [watchLaterError, setWatchLaterError] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const fetchWatchLater = useCallback((forceRefresh = false) => {
    if (forceRefresh) {
      setWatchLaterRefreshing(true);
      showToast('Liste YouTube\'dan güncelleniyor...');
    }
    const url = forceRefresh ? '/api/youtube/playlist?refresh=true' : '/api/youtube/playlist';
    fetch(url)
      .then((r) => r.json())
      .then((data: {
        ok: boolean;
        results?: YouTubeSearchResult[];
        allResults?: YouTubeSearchResult[];
        errorMessage?: string;
      }) => {
        const all = data.ok ? (data.allResults ?? data.results ?? []) : [];
        if (data.ok && Array.isArray(all)) {
          setWatchLaterVideos(all);
          setWatchLaterError(null);
          if (forceRefresh) {
            showToast(`Liste güncellendi (${all.length} video)`);
          }
        } else {
          setWatchLaterError(data.errorMessage ?? null);
          if (forceRefresh) {
            showToast(data.errorMessage ?? 'Liste güncellenemedi');
          }
        }
      })
      .catch(() => {
        setWatchLaterError('YouTube listesine ulaşılamadı');
        if (forceRefresh) {
          showToast('Bağlantı hatası: YouTube listesi güncellenemedi');
        }
      })
      .finally(() => {
        setWatchLaterLoading(false);
        setWatchLaterRefreshing(false);
      });
  }, [showToast]);

  // Initial load only from server cache — NO automatic polling interval to protect API quota!
  useEffect(() => {
    fetchWatchLater(false);
  }, [fetchWatchLater]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const openExternalUrlInNewTab = useCallback(
    (url: string, label: string) => {
      setBlockedPopupUrl(null);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (win) {
        showToast(`${label} açıldı`);
        try {
          win.focus();
        } catch {
          // ignore
        }
      } else {
        setBlockedPopupUrl({ name: label, url });
      }
    },
    [showToast]
  );

  const handleIncomingTvCommand = useCallback(
    (cmd: ValidatedClientMessage) => {
      switch (cmd.type) {
        case 'NAVIGATE': {
          performSpatialNavigation(containerRef.current, cmd.direction);
          break;
        }
        case 'COMMAND': {
          if (cmd.action === 'PLAY') {
            playerHandleRef.current?.play();
          } else if (cmd.action === 'PAUSE') {
            playerHandleRef.current?.pause();
          } else if (cmd.action === 'TOGGLE_PLAY') {
            playerHandleRef.current?.togglePlay();
          } else if (cmd.action === 'MUTE') {
            playerHandleRef.current?.setMuted(true);
          } else if (cmd.action === 'UNMUTE') {
            playerHandleRef.current?.setMuted(false);
          } else if (cmd.action === 'TOGGLE_MUTE') {
            playerHandleRef.current?.toggleMute();
          }
          break;
        }
        case 'SET_VOLUME': {
          playerHandleRef.current?.setVolume(cmd.volume);
          break;
        }
        case 'ADJUST_VOLUME': {
          playerHandleRef.current?.adjustVolume(cmd.delta);
          break;
        }
        case 'OPEN_SHORTCUT': {
          const item = serverStateRef.current.shortcuts.find((s) => s.id === cmd.shortcutId);
          if (item) {
            openExternalUrlInNewTab(item.url, item.name);
          }
          break;
        }
        case 'OPEN_YOUTUBE_EXTERNAL': {
          const externalUrl = buildSafeYouTubeExternalUrl(cmd.target, cmd.queryOrVideoId);
          if (externalUrl) {
            openExternalUrlInNewTab(
              externalUrl,
              cmd.target === 'video' ? 'YouTube Video' : `YouTube: ${cmd.queryOrVideoId}`
            );
          }
          break;
        }
        default:
          break;
      }
    },
    [openExternalUrlInNewTab]
  );

  const { connectionStatus, serverState, sendCommand } = useWsClient('tv', handleIncomingTvCommand);
  const serverStateRef = useRef(serverState);
  serverStateRef.current = serverState;

  // Clock updater
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClockText(
        now.toLocaleTimeString('tr-TR', {
          hour: '2-digit',
          minute: '2-digit'
        })
      );
    };
    updateClock();
    const id = window.setInterval(updateClock, 15000);
    return () => window.clearInterval(id);
  }, []);

  // Fetch QR Code & LAN URL info
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => {
        setHealthInfo({
          primaryRemoteUrl: data.primaryRemoteUrl,
          lanRemoteUrls: data.lanRemoteUrls ?? [],
          qrCodeDataUrl: data.qrCodeDataUrl ?? null,
          youtubeApiConfigured: Boolean(data.youtubeApiConfigured)
        });
      })
      .catch(() => {
        // ignore
      });
  }, []);

  // Ensure Chrome Bookmarks Bar is hidden whenever the TV Controller window is focused
  useEffect(() => {
    const onFocus = () => {
      sendCommand({ type: 'TV_STATUS_UPDATE', state: {} });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [sendCommand]);

  // Initialize roving tabindex on mount and view transitions
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!containerRef.current) return;
      const candidates = getSpatialCandidates(containerRef.current);
      if (
        candidates.length > 0 &&
        (!document.activeElement || document.activeElement === document.body)
      ) {
        applyRovingTabIndex(containerRef.current, candidates[0]);
      }
    }, 100);
    return () => window.clearTimeout(timer);
  }, [serverState.activeView, isEditMode]);

  // Modern Web Guidance: Fallback for <dialog closedby="any"> on browsers without native closedBy support
  useEffect(() => {
    const dialogs = [qrDialogRef.current, addDialogRef.current].filter(
      (d): d is HTMLDialogElement => d !== null
    );
    if (dialogs.length === 0) return;
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const handlers = dialogs.map((dialog) => {
        const handleBackdropClick = (event: MouseEvent) => {
          if (event.target !== dialog) return;
          const rect = dialog.getBoundingClientRect();
          const isDialogContent =
            rect.top <= event.clientY &&
            event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX &&
            event.clientX <= rect.left + rect.width;
          if (!isDialogContent) {
            dialog.close();
          }
        };
        dialog.addEventListener('click', handleBackdropClick);
        return () => dialog.removeEventListener('click', handleBackdropClick);
      });
      return () => handlers.forEach((cleanup) => cleanup());
    }
  }, []);

  // Spatial keyboard navigation listener (Arrow keys, Escape, Backspace)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;

      const target = e.nativeEvent.composedPath()[0] ?? e.target;
      if (isEditableControl(target)) {
        if (e.key === 'Escape') {
          (target as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }

      if (e.key === 'ArrowUp') {
        if (performSpatialNavigation(containerRef.current, 'UP')) {
          e.preventDefault();
        }
      } else if (e.key === 'ArrowDown') {
        if (performSpatialNavigation(containerRef.current, 'DOWN')) {
          e.preventDefault();
        }
      } else if (e.key === 'ArrowLeft') {
        if (performSpatialNavigation(containerRef.current, 'LEFT')) {
          e.preventDefault();
        }
      } else if (e.key === 'ArrowRight') {
        if (performSpatialNavigation(containerRef.current, 'RIGHT')) {
          e.preventDefault();
        }
      } else if (
        e.key === 'Backspace' ||
        (e.key === 'Escape' && !qrDialogRef.current?.open && !addDialogRef.current?.open)
      ) {
        if (serverState.activeView === 'player') {
          e.preventDefault();
          sendCommand({ type: 'COMMAND', action: 'GO_HOME' });
        } else if (isEditMode) {
          e.preventDefault();
          setIsEditMode(false);
        }
      }
    },
    [sendCommand, serverState.activeView, isEditMode]
  );

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        showToast('Tam ekran için F11 tuşuna basabilirsiniz');
      });
    } else {
      document.exitFullscreen().catch(() => {
        // ignore
      });
    }
  };

  const handleShortcutClick = (item: ShortcutItem) => {
    sendCommand({ type: 'OPEN_SHORTCUT', shortcutId: item.id });
  };

  const preserveFocusBeforeRemoval = (cardElement: HTMLElement | null) => {
    if (!containerRef.current || !cardElement) return;
    if (!cardElement.contains(document.activeElement)) return;
    const allCandidates = getSpatialCandidates(containerRef.current);
    const remaining = allCandidates.filter((el) => !cardElement.contains(el));
    if (remaining.length > 0) {
      applyRovingTabIndex(containerRef.current, remaining[0]);
    }
  };

  const handleMoveShortcut = (
    item: ShortcutItem,
    direction: 'PREV' | 'NEXT',
    sectionId: string
  ) => {
    const scopeEl = sectionRefs.current[sectionId] ?? homeMainRef.current;
    runWithScopedTransition(scopeEl, () => {
      sendCommand({
        type: 'REORDER_SHORTCUT',
        shortcutId: item.id,
        direction
      });
    });
  };

  const handleDropShortcut = (sourceId: string, targetId: string, sectionId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const scopeEl = sectionRefs.current[sectionId] ?? homeMainRef.current;
    runWithScopedTransition(scopeEl, () => {
      sendCommand({
        type: 'REORDER_SHORTCUT',
        shortcutId: sourceId,
        targetShortcutId: targetId
      });
    });
  };

  const handleToggleHideShortcut = (
    item: ShortcutItem,
    sectionId: string,
    cardEl: HTMLElement | null
  ) => {
    const nextHidden = !item.hidden;
    const scopeEl = sectionRefs.current[sectionId] ?? homeMainRef.current;
    runWithScopedTransition(scopeEl, () => {
      if (nextHidden) {
        preserveFocusBeforeRemoval(cardEl);
      }
      sendCommand({
        type: 'TOGGLE_SHORTCUT_HIDDEN',
        shortcutId: item.id,
        hidden: nextHidden
      });
    });
  };

  const handleDeleteShortcut = (
    item: ShortcutItem,
    sectionId: string,
    cardEl: HTMLElement | null
  ) => {
    const scopeEl = sectionRefs.current[sectionId] ?? homeMainRef.current;
    runWithScopedTransition(scopeEl, () => {
      preserveFocusBeforeRemoval(cardEl);
      sendCommand({
        type: 'DELETE_SHORTCUT',
        shortcutId: item.id
      });
    });
  };

  const handleMoveSection = (sectionId: TVSectionId, direction: 'UP' | 'DOWN') => {
    runWithScopedTransition(homeMainRef.current, () => {
      sendCommand({
        type: 'REORDER_SECTION',
        sectionId,
        direction
      });
    });
  };

  const handleToggleSectionHidden = (sec: TVSectionConfig) => {
    const nextHidden = !sec.hidden;
    runWithScopedTransition(homeMainRef.current, () => {
      sendCommand({
        type: 'TOGGLE_SECTION_HIDDEN',
        sectionId: sec.id,
        hidden: nextHidden
      });
    });
  };

  const handleResetLayout = () => {
    runWithScopedTransition(homeMainRef.current, () => {
      sendCommand({ type: 'RESET_LAYOUT' });
    });
    showToast('Varsayılan düzene sıfırlandı');
  };

  const handleAddShortcutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newAppName.trim();
    const url = newAppUrl.trim();
    if (!name || !url.startsWith('https://')) {
      showToast('Lütfen geçerli bir ad ve https:// adresi girin');
      return;
    }
    sendCommand({
      type: 'ADD_SHORTCUT',
      name,
      url,
      category: newAppCategory,
      subtitle: newAppSubtitle.trim() || undefined,
      color: newAppColor
    });
    setNewAppName('');
    setNewAppUrl('https://');
    setNewAppSubtitle('');
    addDialogRef.current?.close();
    showToast(`"${name}" eklendi`);
  };

  const sections = (
    serverState.sections && serverState.sections.length > 0
      ? serverState.sections
      : DEFAULT_TV_SECTIONS
  ).filter((s) => s.id !== 'youtube_search');

  const remoteUrlDisplay =
    healthInfo?.primaryRemoteUrl ??
    serverState.lanUrls[0] ??
    `${window.location.origin}/remote`;

  const renderShortcutSection = (
    sec: TVSectionConfig,
    secIdx: number,
    category: ShortcutCategory
  ) => {
    const allInCategory = serverState.shortcuts.filter((s) => s.category === category);
    const visibleItems = allInCategory.filter((s) => !s.hidden);
    const hiddenItems = allInCategory.filter((s) => s.hidden);

    if (sec.hidden && !isEditMode) {
      return null;
    }

    const gridClass =
      category === 'bookmark'
        ? 'tv-card-grid tv-card-grid-series'
        : category === 'platform'
          ? 'tv-card-grid tv-card-grid-platforms'
          : 'tv-card-grid tv-card-grid-dizi';

    return (
      <section
        key={sec.id}
        ref={(el) => {
          sectionRefs.current[sec.id] = el;
        }}
        className={`tv-section ${sec.hidden ? 'is-section-hidden' : ''} ${
          isEditMode ? 'is-section-editing' : ''
        }`}
      >
        <div className="tv-section-header">
          <div className="tv-section-title-group">
            <h2 className="tv-section-title">{sec.title}</h2>
            {sec.hidden && <span className="tv-hidden-pill">Gizli</span>}
            {!isEditMode && hiddenItems.length > 0 && (
              <button
                type="button"
                data-spatial-item="true"
                className="tv-hidden-count-btn"
                onClick={() => setIsEditMode(true)}
              >
                +{hiddenItems.length} gizli
              </button>
            )}
          </div>

          {isEditMode && (
            <div className="tv-section-edit-bar">
              <button
                type="button"
                data-spatial-item="true"
                className="tv-btn tv-btn-sm tv-btn-secondary"
                disabled={secIdx === 0}
                onClick={() => handleMoveSection(sec.id, 'UP')}
              >
                ▲ Yukarı
              </button>
              <button
                type="button"
                data-spatial-item="true"
                className="tv-btn tv-btn-sm tv-btn-secondary"
                disabled={secIdx === sections.length - 1}
                onClick={() => handleMoveSection(sec.id, 'DOWN')}
              >
                ▼ Aşağı
              </button>
              <button
                type="button"
                data-spatial-item="true"
                className={`tv-btn tv-btn-sm ${
                  sec.hidden ? 'tv-btn-primary' : 'tv-btn-secondary'
                }`}
                onClick={() => handleToggleSectionHidden(sec)}
              >
                {sec.hidden ? 'Göster' : 'Sekmeyi Gizle'}
              </button>
            </div>
          )}
        </div>

        {visibleItems.length === 0 ? (
          <div className="tv-empty-category">
            <span>Bu bölümde görünür öğe yok.</span>
            {hiddenItems.length > 0 && !isEditMode && (
              <button
                type="button"
                data-spatial-item="true"
                className="tv-btn tv-btn-sm tv-btn-secondary"
                onClick={() => setIsEditMode(true)}
              >
                Gizlenenleri Göster ({hiddenItems.length})
              </button>
            )}
          </div>
        ) : (
          <div className={gridClass}>
            {visibleItems.map((item, idx) => {
              const isSeriesBookmark = category === 'bookmark';
              const isCompact = category === 'dizi_site';
              const isDragOver = dragOverShortcutId === item.id;
              const posterSrc =
                item.imageUrl || `/api/series-poster?q=${encodeURIComponent(item.name)}`;
              const platformIconSrc =
                !isSeriesBookmark
                  ? item.imageUrl || resolveShortcutIconUrl(item.id, item.url)
                  : undefined;

              return (
                <div
                  key={item.id}
                  className={`tv-card-item-shell ${isEditMode ? 'is-editing' : ''} ${
                    isDragOver ? 'is-drag-over' : ''
                  }`}
                  draggable={isEditMode}
                  onDragStart={() => setDraggedShortcutId(item.id)}
                  onDragOver={(e) => {
                    if (!isEditMode || !draggedShortcutId || draggedShortcutId === item.id) return;
                    e.preventDefault();
                    setDragOverShortcutId(item.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverShortcutId === item.id) setDragOverShortcutId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverShortcutId(null);
                    if (draggedShortcutId && draggedShortcutId !== item.id) {
                      handleDropShortcut(draggedShortcutId, item.id, sec.id);
                    }
                    setDraggedShortcutId(null);
                  }}
                  onDragEnd={() => {
                    setDraggedShortcutId(null);
                    setDragOverShortcutId(null);
                  }}
                >
                  {isSeriesBookmark ? (
                    <button
                      type="button"
                      data-spatial-item="true"
                      className="tv-series-card"
                      style={{ '--card-accent': item.color } as React.CSSProperties}
                      onClick={() => handleShortcutClick(item)}
                    >
                      <div className="tv-series-cover">
                        <img
                          src={posterSrc}
                          alt={item.name}
                          className="tv-series-img"
                          loading="lazy"
                        />
                        <div className="tv-series-play-overlay" aria-hidden="true">
                          <span>▶</span>
                        </div>
                      </div>
                      <div className="tv-series-meta">
                        <span className="tv-series-title">{item.name}</span>
                        {item.subtitle && (
                          <span className="tv-series-ep">{item.subtitle}</span>
                        )}
                      </div>
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-spatial-item="true"
                      className={`tv-shortcut-card ${isCompact ? 'tv-shortcut-card-compact' : ''}`}
                      style={{ '--card-accent': item.color } as React.CSSProperties}
                      onClick={() => handleShortcutClick(item)}
                    >
                      <div className="tv-shortcut-badge">
                        {platformIconSrc ? (
                          <img
                            src={platformIconSrc}
                            alt=""
                            className="tv-shortcut-icon-img"
                            loading="lazy"
                          />
                        ) : (
                          item.badge
                        )}
                      </div>
                      <div className="tv-shortcut-info">
                        <span className="tv-shortcut-name">{item.name}</span>
                        {item.subtitle && (
                          <span className="tv-shortcut-sub">{item.subtitle}</span>
                        )}
                      </div>
                    </button>
                  )}

                  {isEditMode && (
                    <div
                      className="tv-card-edit-actions"
                      role="toolbar"
                      aria-label={`${item.name} düzenleme`}
                    >
                      <button
                        type="button"
                        data-spatial-item="true"
                        className="tv-card-ctrl-btn"
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveShortcut(item, 'PREV', sec.id);
                        }}
                        title="Öne Taşı"
                      >
                        ◀
                      </button>
                      <button
                        type="button"
                        data-spatial-item="true"
                        className="tv-card-ctrl-btn"
                        disabled={idx === visibleItems.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMoveShortcut(item, 'NEXT', sec.id);
                        }}
                        title="Arkaya Taşı"
                      >
                        ▶
                      </button>
                      <button
                        type="button"
                        data-spatial-item="true"
                        className="tv-card-ctrl-btn tv-card-ctrl-hide"
                        onClick={(e) => {
                          e.stopPropagation();
                          const shell = e.currentTarget.closest(
                            '.tv-card-item-shell'
                          ) as HTMLElement | null;
                          handleToggleHideShortcut(item, sec.id, shell);
                        }}
                      >
                        Gizle
                      </button>
                      <button
                        type="button"
                        data-spatial-item="true"
                        className="tv-card-ctrl-btn tv-card-ctrl-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          const shell = e.currentTarget.closest(
                            '.tv-card-item-shell'
                          ) as HTMLElement | null;
                          handleDeleteShortcut(item, sec.id, shell);
                        }}
                      >
                        Sil
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {isEditMode && hiddenItems.length > 0 && (
          <div className="tv-hidden-drawer">
            <div className="tv-hidden-drawer-title">Gizlenenler ({hiddenItems.length})</div>
            <div className="tv-hidden-items-list">
              {hiddenItems.map((item) => (
                <div key={item.id} className="tv-hidden-item-chip">
                  <span className="tv-hidden-item-name">{item.name}</span>
                  <button
                    type="button"
                    data-spatial-item="true"
                    className="tv-card-ctrl-btn tv-card-ctrl-show"
                    onClick={(e) => {
                      const chip = e.currentTarget.closest(
                        '.tv-hidden-item-chip'
                      ) as HTMLElement | null;
                      handleToggleHideShortcut(item, sec.id, chip);
                    }}
                  >
                    Göster
                  </button>
                  <button
                    type="button"
                    data-spatial-item="true"
                    className="tv-card-ctrl-btn tv-card-ctrl-delete"
                    onClick={(e) => {
                      const chip = e.currentTarget.closest(
                        '.tv-hidden-item-chip'
                      ) as HTMLElement | null;
                      handleDeleteShortcut(item, sec.id, chip);
                    }}
                  >
                    Sil
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  };

  const handlePlayWatchLaterVideo = useCallback(
    (video: YouTubeSearchResult) => {
      const url = buildSafeYouTubeExternalUrl('video', video.videoId);
      if (url) {
        openExternalUrlInNewTab(url, video.title);
      }
    },
    [openExternalUrlInNewTab]
  );

  const renderWatchLaterSection = (sec: TVSectionConfig, secIdx: number) => {
    if (sec.hidden && !isEditMode) return null;

    const deletedWatchLaterSet = new Set(serverState.deletedWatchLaterVideoIds ?? []);
    const visibleVideos = watchLaterVideos.filter((v) => !deletedWatchLaterSet.has(v.videoId));
    const removedVideos = watchLaterVideos.filter((v) => deletedWatchLaterSet.has(v.videoId));

    return (
      <section
        key={sec.id}
        ref={(el) => {
          sectionRefs.current[sec.id] = el;
        }}
        className={`tv-section ${sec.hidden ? 'is-section-hidden' : ''} ${
          isEditMode ? 'is-section-editing' : ''
        }`}
        aria-label={sec.title}
      >
        <div className="tv-section-header">
          <div className="tv-section-title-group">
            <h2 className="tv-section-title">
              {sec.title}
              {visibleVideos.length > 0 && (
                <span className="tv-section-count"> ({visibleVideos.length})</span>
              )}
            </h2>
            {sec.hint && <span className="tv-section-hint">{sec.hint}</span>}
            <button
              type="button"
              data-spatial-item="true"
              className="tv-btn tv-btn-sm tv-btn-secondary tv-refresh-chip"
              onClick={() => fetchWatchLater(true)}
              disabled={watchLaterRefreshing}
              title="Listeyi YouTube'dan Yenile (Kota Tasarruflu)"
            >
              {watchLaterRefreshing ? 'Yenileniyor...' : '🔄 Yenile'}
            </button>
            {!isEditMode && removedVideos.length > 0 && (
              <button
                type="button"
                data-spatial-item="true"
                className="tv-btn tv-btn-sm tv-btn-secondary"
                onClick={() => setIsEditMode(true)}
              >
                Kaldırılanlar ({removedVideos.length})
              </button>
            )}
          </div>

          {isEditMode && (
            <div
              className="tv-section-edit-bar"
              role="toolbar"
              aria-label={`${sec.title} sekme ayarları`}
            >
              <button
                type="button"
                data-spatial-item="true"
                className="tv-section-order-btn"
                disabled={secIdx === 0}
                onClick={() => handleMoveSection(sec.id, 'UP')}
                title="Bölümü Yukarı Taşı"
              >
                ▲ Yukarı
              </button>
              <button
                type="button"
                data-spatial-item="true"
                className="tv-section-order-btn"
                disabled={secIdx === sections.length - 1}
                onClick={() => handleMoveSection(sec.id, 'DOWN')}
                title="Bölümü Aşağı Taşı"
              >
                ▼ Aşağı
              </button>
              <button
                type="button"
                data-spatial-item="true"
                className={`tv-section-hide-btn ${
                  sec.hidden ? 'is-btn-show' : 'is-btn-hide'
                }`}
                onClick={() => handleToggleSectionHidden(sec)}
              >
                {sec.hidden ? 'Göster' : 'Sekmeyi Gizle'}
              </button>
            </div>
          )}
        </div>

        {watchLaterLoading && watchLaterVideos.length === 0 ? (
          <div className="tv-empty-category">
            <span>Daha Sonra İzle listesi yükleniyor...</span>
          </div>
        ) : visibleVideos.length === 0 ? (
          <div className="tv-empty-category">
            <span>
              {removedVideos.length > 0
                ? 'Tüm videolar listeden kaldırıldı.'
                : (watchLaterError ?? 'Bu listede henüz video bulunmuyor.')}
            </span>
            <button
              type="button"
              data-spatial-item="true"
              className="tv-btn tv-btn-sm tv-btn-secondary"
              onClick={() => fetchWatchLater(true)}
              disabled={watchLaterRefreshing}
            >
              {watchLaterRefreshing ? 'Yenileniyor...' : '🔄 Yenile'}
            </button>
            {removedVideos.length > 0 && !isEditMode && (
              <button
                type="button"
                data-spatial-item="true"
                className="tv-btn tv-btn-sm tv-btn-secondary"
                onClick={() => setIsEditMode(true)}
              >
                Kaldırılanları Göster ({removedVideos.length})
              </button>
            )}
          </div>
        ) : (
          <div className="tv-card-grid tv-card-grid-series">
            {visibleVideos.map((video) => (
              <div
                key={video.videoId}
                className={`tv-card-item-shell ${isEditMode ? 'is-editing' : ''}`}
              >
                <button
                  type="button"
                  data-spatial-item="true"
                  className="tv-series-card tv-watch-later-card"
                  onClick={() => handlePlayWatchLaterVideo(video)}
                >
                  <div className="tv-series-cover">
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="tv-series-img"
                      loading="lazy"
                    />
                    <div className="tv-series-play-overlay" aria-hidden="true">
                      <span>▶</span>
                    </div>
                    <div className="tv-youtube-tag" aria-hidden="true">
                      YouTube
                    </div>
                  </div>
                  <div className="tv-series-meta">
                    <span className="tv-series-title" title={video.title}>
                      {video.title}
                    </span>
                    <span className="tv-series-ep">{video.channelTitle}</span>
                  </div>
                </button>

                {isEditMode && (
                  <div
                    className="tv-card-edit-actions"
                    role="toolbar"
                    aria-label={`${video.title} düzenleme`}
                  >
                    <button
                      type="button"
                      data-spatial-item="true"
                      className="tv-card-ctrl-btn tv-card-ctrl-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        sendCommand({
                          type: 'REMOVE_WATCH_LATER',
                          videoId: video.videoId
                        });
                        showToast(`Video listeden kaldırıldı: ${video.title.slice(0, 32)}`);
                      }}
                      title="Sonra İzle Listesinden Kaldır"
                    >
                      Kaldır
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isEditMode && removedVideos.length > 0 && (
          <div className="tv-hidden-drawer">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div className="tv-hidden-drawer-title">
                Kaldırılan Videolar ({removedVideos.length})
              </div>
              <button
                type="button"
                data-spatial-item="true"
                className="tv-btn tv-btn-sm tv-btn-secondary"
                onClick={() => {
                  sendCommand({ type: 'CLEAR_REMOVED_WATCH_LATER' });
                  showToast('Kaldırılan tüm videolar geri yüklendi');
                }}
              >
                Tümünü Geri Al
              </button>
            </div>
            <div className="tv-hidden-items-list">
              {removedVideos.map((video) => (
                <div key={video.videoId} className="tv-hidden-item-chip">
                  <span className="tv-hidden-item-name">{video.title}</span>
                  <button
                    type="button"
                    data-spatial-item="true"
                    className="tv-card-ctrl-btn tv-card-ctrl-show"
                    onClick={() => {
                      sendCommand({
                        type: 'RESTORE_WATCH_LATER',
                        videoId: video.videoId
                      });
                      showToast(`Geri yüklendi: ${video.title.slice(0, 32)}`);
                    }}
                  >
                    Geri Al
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    );
  };

  /**
   * Stageshow Craft: Compact Hero Spotlight Banner for 10-Foot TV Experience.
   * Focuses purely on media content: active series and top watch later video in a single row.
   * Unnecessary system widgets (CoreAudio and IP cards) removed to preserve vertical TV space.
   */
  const renderBentoSpotlight = () => {
    const heroBookmark = serverState.shortcuts.find(
      (s) => s.category === 'bookmark' && !s.hidden
    );
    const topWatchLater = watchLaterVideos.find(
      (v) => !serverState.deletedWatchLaterVideoIds?.includes(v.videoId)
    );

    if (!heroBookmark && !topWatchLater) {
      return null;
    }

    return (
      <section
        className={`tv-bento-spotlight ${!topWatchLater ? 'is-hero-only' : ''}`}
        aria-label="Öne Çıkan Dizi ve Medya Paneli"
      >
        {/* 1. HERO TILE: Asymmetric spotlight banner for current series */}
        {heroBookmark && (
          <div className="tv-bento-tile tv-bento-hero">
            <div className="tv-bento-hero-inner">
              {heroBookmark.imageUrl && (
                <img
                  src={heroBookmark.imageUrl}
                  alt={heroBookmark.name}
                  className="tv-bento-hero-backdrop"
                  loading="lazy"
                />
              )}
              <div className="tv-bento-hero-scrim" />
              <div className="tv-bento-hero-content">
                <div className="tv-bento-tag">
                  <span className="tv-bento-dot-live" />
                  <span>Kaldığın Yerden Devam Et</span>
                </div>
                <h2 className="tv-bento-hero-title">{heroBookmark.name}</h2>
                <div className="tv-bento-hero-meta">
                  <span className="tv-bento-pill-badge">{heroBookmark.subtitle || 'Dizi Takibi'}</span>
                  <span className="tv-bento-status-text">Kayıtlı Bölüm</span>
                </div>
                <div className="tv-bento-progress-track">
                  <div className="tv-bento-progress-fill" style={{ width: '70%' }} />
                </div>
                <div className="tv-bento-hero-btns">
                  <button
                    type="button"
                    data-spatial-item="true"
                    className="tv-btn tv-btn-accent tv-bento-btn"
                    onClick={() => handleShortcutClick(heroBookmark)}
                  >
                    ▶ Hemen İzle
                  </button>
                  <button
                    type="button"
                    data-spatial-item="true"
                    className="tv-btn tv-btn-secondary tv-bento-btn"
                    onClick={() => {
                      const seriesKey = heroBookmark.id.replace(/^bm-series-/, '');
                      sendCommand({ type: 'ADVANCE_PROGRESS', key: seriesKey });
                      showToast(`${heroBookmark.name}: Sonraki bölüme ilerletildi (+1)`);
                    }}
                    title="Bölüm numarasını +1 artır"
                  >
                    +1 Bölüm
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. YOUTUBE / WATCH LATER COMPACT TILE */}
        {topWatchLater && (
          <div className="tv-bento-tile tv-bento-yt">
            <div className="tv-bento-tile-header">
              <span className="tv-bento-tile-eyebrow">Daha Sonra İzle</span>
              <span className="tv-bento-pill">YouTube</span>
            </div>
            <div className="tv-bento-yt-body">
              <div className="tv-bento-yt-thumb-wrap">
                <img
                  src={topWatchLater.thumbnailUrl}
                  alt={topWatchLater.title}
                  className="tv-bento-yt-thumb"
                  loading="lazy"
                />
                <div className="tv-bento-yt-play-pill">▶</div>
              </div>
              <div className="tv-bento-yt-title">{topWatchLater.title}</div>
              <button
                type="button"
                data-spatial-item="true"
                className="tv-btn tv-btn-sm tv-btn-accent tv-bento-btn-full"
                onClick={() => handlePlayWatchLaterVideo(topWatchLater)}
              >
                ▶ Oynat
              </button>
            </div>
          </div>
        )}
      </section>
    );
  };

  const [hideMobileBanner, setHideMobileBanner] = useState(false);
  const isMobileDevice =
    !hideMobileBanner &&
    typeof window !== 'undefined' &&
    (/iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768);

  return (
    <div ref={containerRef} className="tv-shell" onKeyDown={handleKeyDown}>
      {isMobileDevice && (
        <aside className="tv-mobile-warning-banner" role="region" aria-label="Mobil Cihaz Uyarısı">
          <div className="tv-mobile-warning-content">
            <span className="tv-mobile-warning-icon">📱</span>
            <div className="tv-mobile-warning-text">
              <strong>Mobil Cihazdasınız</strong>
              <span>Bu ekran televizyon görünümüdür. İsterseniz iPhone kumandasını kullanabilir veya TV arayüzünü televizyonda açabilirsiniz:</span>
            </div>
            <button
              type="button"
              className="tv-btn tv-btn-icon"
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
              onClick={() => setHideMobileBanner(true)}
              aria-label="Uyarıyı Kapat"
            >
              ✕
            </button>
          </div>
          <div className="tv-mobile-warning-actions">
            <a href="/remote" className="tv-btn tv-btn-accent">
              📱 iPhone Kumandası (/remote)
            </a>
            <button
              type="button"
              className="tv-btn tv-btn-secondary"
              onClick={() => {
                fetch('/api/launch-tv', { method: 'POST' }).catch(() => {});
                showToast('Bilgisayarda / Televizyonda TV Arayüzü Başlatılıyor...');
              }}
            >
              🖥️ TV'yi Televizyonda Aç
            </button>
            <button
              type="button"
              className="tv-btn tv-btn-secondary"
              onClick={() => setHideMobileBanner(true)}
            >
              📱 Bu Ekranda Devam Et
            </button>
          </div>
        </aside>
      )}

      {/* Clean Minimal Topbar */}
      <header className="tv-topbar">
        <div className="tv-brand">
          <div className="tv-brand-icon" aria-hidden="true">
            📺
          </div>
          <h1 className="tv-brand-title">Smart TV</h1>
          <div
            className={`tv-status-pill ${
              connectionStatus === 'connected' ? 'is-online' : 'is-offline'
            }`}
          >
            <span className="tv-status-dot" />
            <span>
              {connectionStatus === 'connected'
                ? serverState.remoteConnectedCount > 0
                  ? `${serverState.remoteConnectedCount} Kumanda Bağlı`
                  : 'Hazır'
                : 'Bağlanıyor...'}
            </span>
          </div>
        </div>

        <div className="tv-topbar-controls">
          {serverState.nowPlaying && serverState.activeView !== 'player' && (
            <button
              type="button"
              data-spatial-item="true"
              className="tv-btn tv-btn-accent"
              onClick={() =>
                sendCommand({
                  type: 'PLAY_VIDEO',
                  videoId: serverState.nowPlaying!.videoId,
                  title: serverState.nowPlaying!.title,
                  channelTitle: serverState.nowPlaying!.channelTitle,
                  thumbnailUrl: serverState.nowPlaying!.thumbnailUrl
                })
              }
            >
              ▶ Oynatıcıya Dön
            </button>
          )}

          {serverState.activeView === 'home' && (
            <button
              type="button"
              data-spatial-item="true"
              className={`tv-btn ${isEditMode ? 'tv-btn-primary' : 'tv-btn-secondary'}`}
              onClick={() => setIsEditMode((prev) => !prev)}
            >
              {isEditMode ? '✓ Bitti' : 'Düzenle'}
            </button>
          )}

          <button
            type="button"
            data-spatial-item="true"
            className="tv-btn tv-btn-secondary"
            onClick={() => qrDialogRef.current?.showModal()}
          >
            📱 Kumanda Bağla
          </button>

          <button
            type="button"
            data-spatial-item="true"
            className="tv-btn tv-btn-secondary tv-btn-icon"
            onClick={toggleScheme}
            aria-label={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
            title={isDark ? 'Açık Tema' : 'Koyu Tema'}
          >
            <span aria-hidden="true">{isDark ? '☀️' : '🌙'}</span>
          </button>

          <button
            type="button"
            data-spatial-item="true"
            className="tv-btn tv-btn-secondary tv-btn-icon"
            onClick={toggleFullScreen}
            aria-label="Tam Ekran"
            title="Tam Ekran (F11)"
          >
            ⛶
          </button>

          <div className="tv-clock" aria-label="Saat">
            {clockText}
          </div>
        </div>
      </header>

      {/* Brief Floating Toast when needed */}
      {toastMessage && <div className="tv-floating-toast">{toastMessage}</div>}

      {/* Popup Blocker Fallback Banner */}
      {blockedPopupUrl && (
        <div className="tv-popup-alert" role="alert">
          <div>
            <strong>{blockedPopupUrl.name}</strong> için yeni sekme izni gerekiyor.
          </div>
          <div className="tv-popup-alert-actions">
            <a
              href={blockedPopupUrl.url}
              target="_blank"
              rel="noopener noreferrer"
              data-spatial-item="true"
              className="tv-btn tv-btn-primary"
              onClick={() => setBlockedPopupUrl(null)}
            >
              ↗ Şimdi Aç
            </a>
            <button
              type="button"
              data-spatial-item="true"
              className="tv-btn tv-btn-secondary"
              onClick={() => setBlockedPopupUrl(null)}
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area: Either YouTube Player View or Clean Home Screen */}
      {serverState.activeView === 'player' && serverState.nowPlaying ? (
        <YouTubePlayerView
          ref={playerHandleRef}
          video={serverState.nowPlaying}
          initialVolume={serverState.volume}
          initialMuted={serverState.muted}
          onStatusUpdate={(st) =>
            sendCommand({
              type: 'TV_STATUS_UPDATE',
              state: st
            })
          }
          onOpenExternalYouTube={(videoId) => {
            const url = buildSafeYouTubeExternalUrl('video', videoId);
            if (url) openExternalUrlInNewTab(url, 'YouTube Video');
          }}
          onReturnHome={() => sendCommand({ type: 'COMMAND', action: 'GO_HOME' })}
        />
      ) : (
        <main ref={homeMainRef} className="tv-home-content">
          {isEditMode && (
            <section className="tv-edit-panel" aria-label="Düzenleme Paneli">
              <div className="tv-edit-panel-top">
                <div>
                  <h2 className="tv-edit-panel-title">Ekran Düzenini Özelleştir</h2>
                  <p className="tv-edit-panel-desc">
                    Kartları sürükleyerek veya ◀ ▶ tuşlarıyla sıralayın, istemediklerinizi gizleyin ya da silin.
                  </p>
                </div>
                <div className="tv-edit-panel-actions">
                  <button
                    type="button"
                    data-spatial-item="true"
                    className="tv-btn tv-btn-primary"
                    onClick={() => addDialogRef.current?.showModal()}
                  >
                    + Yeni Ekle
                  </button>
                  <button
                    type="button"
                    data-spatial-item="true"
                    className="tv-btn tv-btn-secondary"
                    onClick={handleResetLayout}
                  >
                    Varsayılana Sıfırla
                  </button>
                  <button
                    type="button"
                    data-spatial-item="true"
                    className="tv-btn tv-btn-accent"
                    onClick={() => setIsEditMode(false)}
                  >
                    ✓ Tamam
                  </button>
                </div>
              </div>
            </section>
          )}

          {!isEditMode && renderBentoSpotlight()}

          {sections.map((sec, secIdx) => {
            if (sec.id === 'watch_later') {
              return renderWatchLaterSection(sec, secIdx);
            }
            if (sec.id === 'bookmark') {
              return renderShortcutSection(sec, secIdx, 'bookmark');
            }
            if (sec.id === 'platform') {
              return renderShortcutSection(sec, secIdx, 'platform');
            }
            if (sec.id === 'dizi_site') {
              return renderShortcutSection(sec, secIdx, 'dizi_site');
            }
            return null;
          })}
        </main>
      )}

      {/* Modal Dialog for Adding Custom App / Series */}
      <dialog
        ref={addDialogRef}
        {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
        className="tv-qr-dialog"
        aria-labelledby="add-dialog-title"
      >
        <form className="tv-add-dialog-form" onSubmit={handleAddShortcutSubmit}>
          <h2 id="add-dialog-title">Yeni Kısayol Ekle</h2>

          <label className="tv-form-field">
            <span>Bölüm / Kategori</span>
            <select
              className="tv-form-input"
              value={newAppCategory}
              onChange={(e) => setNewAppCategory(e.target.value as ShortcutCategory)}
            >
              <option value="bookmark">İzlemeye Devam Et (Dizi)</option>
              <option value="platform">Platformlar</option>
              <option value="dizi_site">Dizi & Film Siteleri</option>
            </select>
          </label>

          <label className="tv-form-field">
            <span>Adı</span>
            <input
              type="text"
              className="tv-form-input"
              placeholder="Örn: Breaking Bad, BluTV..."
              value={newAppName}
              onChange={(e) => setNewAppName(e.target.value)}
              required
            />
          </label>

          <label className="tv-form-field">
            <span>Web Adresi (https://)</span>
            <input
              type="url"
              className="tv-form-input"
              placeholder="https://..."
              value={newAppUrl}
              onChange={(e) => setNewAppUrl(e.target.value)}
              required
            />
          </label>

          <label className="tv-form-field">
            <span>Sezon / Bölüm Bilgisi (İsteğe bağlı)</span>
            <input
              type="text"
              className="tv-form-input"
              placeholder="Örn: 2. Sezon • 4. Bölüm"
              value={newAppSubtitle}
              onChange={(e) => setNewAppSubtitle(e.target.value)}
            />
          </label>

          <label className="tv-form-field tv-form-field-row">
            <span>Renk</span>
            <input
              type="color"
              className="tv-form-color"
              value={newAppColor}
              onChange={(e) => setNewAppColor(e.target.value)}
            />
          </label>

          <div className="tv-dialog-actions">
            <button
              type="button"
              className="tv-btn tv-btn-secondary"
              onClick={() => addDialogRef.current?.close()}
            >
              İptal
            </button>
            <button type="submit" className="tv-btn tv-btn-primary">
              Ekle
            </button>
          </div>
        </form>
      </dialog>

      {/* Light-Dismiss Modal Dialog for iPhone QR Code */}
      <dialog
        ref={qrDialogRef}
        {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
        className="tv-qr-dialog"
        aria-labelledby="qr-dialog-title"
      >
        <div className="tv-qr-dialog-body">
          <h2 id="qr-dialog-title">📱 iPhone Kumanda</h2>
          <p>Telefonunuzun kamerasıyla QR kodu okutarak kumandayı açın:</p>

          {healthInfo?.qrCodeDataUrl && (
            <div className="tv-qr-box">
              <img
                src={healthInfo.qrCodeDataUrl}
                alt="iPhone Kumanda QR Kodu"
                width={200}
                height={200}
              />
            </div>
          )}

          <div className="tv-qr-url-box">{remoteUrlDisplay}</div>

          <form method="dialog">
            <button type="submit" className="tv-btn tv-btn-primary">
              Kapat
            </button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
