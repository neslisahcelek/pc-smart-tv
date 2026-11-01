import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import type { NowPlayingVideo, PlayerStatus } from '../../shared/types.js';

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState?: {
        UNSTARTED: -1;
        ENDED: 0;
        PLAYING: 1;
        PAUSED: 2;
        BUFFERING: 3;
        CUED: 5;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  loadVideoById: (videoId: string) => void;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getPlayerState: () => number;
  destroy: () => void;
}

export interface YouTubePlayerHandle {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setVolume: (volume: number) => void;
  adjustVolume: (delta: number) => void;
  setMuted: (muted: boolean) => void;
  toggleMute: () => void;
}

interface YouTubePlayerViewProps {
  video: NowPlayingVideo;
  initialVolume: number;
  initialMuted: boolean;
  onStatusUpdate: (update: {
    playerStatus?: PlayerStatus;
    playerErrorCode?: number | null;
    playerErrorMessage?: string | null;
    volume?: number;
    muted?: boolean;
  }) => void;
  onOpenExternalYouTube: (videoId: string) => void;
  onReturnHome: () => void;
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT && window.YT.Player) {
    return Promise.resolve();
  }
  if (ytApiPromise) {
    return ytApiPromise;
  }

  ytApiPromise = new Promise<void>((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      resolve();
    };

    const existingScript = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

function mapYouTubeErrorToTurkish(code: number): string {
  switch (code) {
    case 101:
    case 150:
      return 'Bu videonun sahibi, videonun harici uygulamalarda (gömülü olarak) oynatılmasına izin vermiyor. Videoyu doğrudan YouTube sekmesinde açabilirsiniz.';
    case 100:
      return 'Bu video bulunamadı, silinmiş veya gizli olarak işaretlenmiş.';
    case 2:
      return 'Geçersiz YouTube video kimliği.';
    case 5:
      return 'HTML5 video oynatıcısında bir hata oluştu.';
    default:
      return `Video oynatılırken beklenmeyen bir hata oluştu (Hata Kodu: ${code}).`;
  }
}

export const YouTubePlayerView = forwardRef<YouTubePlayerHandle, YouTubePlayerViewProps>(
  function YouTubePlayerView(
    {
      video,
      initialVolume,
      initialMuted,
      onStatusUpdate,
      onOpenExternalYouTube,
      onReturnHome
    },
    ref
  ) {
    const mountNodeRef = useRef<HTMLDivElement | null>(null);
    const playerRef = useRef<YTPlayerInstance | null>(null);
    const isReadyRef = useRef(false);
    const currentVideoIdRef = useRef(video.videoId);

    const [status, setStatus] = useState<PlayerStatus>('loading');
    const [errorInfo, setErrorInfo] = useState<{ code: number; message: string } | null>(null);

    const onStatusUpdateRef = useRef(onStatusUpdate);
    onStatusUpdateRef.current = onStatusUpdate;

    const onOpenExternalRef = useRef(onOpenExternalYouTube);
    onOpenExternalRef.current = onOpenExternalYouTube;
    const autoOpenedVideoIdRef = useRef<string | null>(null);

    useImperativeHandle(ref, () => ({
      play: () => {
        if (playerRef.current && isReadyRef.current) {
          playerRef.current.playVideo();
        }
      },
      pause: () => {
        if (playerRef.current && isReadyRef.current) {
          playerRef.current.pauseVideo();
        }
      },
      togglePlay: () => {
        if (!playerRef.current || !isReadyRef.current) return;
        const st = playerRef.current.getPlayerState();
        if (st === 1) {
          playerRef.current.pauseVideo();
        } else {
          playerRef.current.playVideo();
        }
      },
      setVolume: (vol: number) => {
        if (!playerRef.current || !isReadyRef.current) return;
        const clamped = Math.max(0, Math.min(100, Math.round(vol)));
        playerRef.current.setVolume(100);
        if (clamped === 0) {
          playerRef.current.mute();
        } else if (playerRef.current.isMuted()) {
          playerRef.current.unMute();
        }
      },
      adjustVolume: (delta: number) => {
        if (!playerRef.current || !isReadyRef.current) return;
        playerRef.current.setVolume(100);
        if (delta > 0 && playerRef.current.isMuted()) {
          playerRef.current.unMute();
        }
      },
      setMuted: (muted: boolean) => {
        if (!playerRef.current || !isReadyRef.current) return;
        if (muted) {
          playerRef.current.mute();
        } else {
          playerRef.current.unMute();
          playerRef.current.setVolume(100);
        }
      },
      toggleMute: () => {
        if (!playerRef.current || !isReadyRef.current) return;
        const currentlyMuted = playerRef.current.isMuted();
        if (currentlyMuted) {
          playerRef.current.unMute();
          playerRef.current.setVolume(100);
        } else {
          playerRef.current.mute();
        }
      }
    }));

    useEffect(() => {
      let cancelled = false;
      setStatus('loading');
      setErrorInfo(null);

      loadYouTubeIframeApi().then(() => {
        if (cancelled || !mountNodeRef.current || !window.YT) return;

        // If player already exists, just load the new videoId
        if (playerRef.current && isReadyRef.current) {
          if (currentVideoIdRef.current !== video.videoId) {
            currentVideoIdRef.current = video.videoId;
            playerRef.current.loadVideoById(video.videoId);
          }
          return;
        }

        const hostDiv = document.createElement('div');
        mountNodeRef.current.innerHTML = '';
        mountNodeRef.current.appendChild(hostDiv);

        currentVideoIdRef.current = video.videoId;
        playerRef.current = new window.YT.Player(hostDiv, {
          videoId: video.videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            controls: 1,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
             origin: window.location.origin
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              isReadyRef.current = true;
              event.target.setVolume(100);
              if (initialMuted) {
                event.target.mute();
              } else {
                event.target.unMute();
              }
              event.target.playVideo();
            },
            onStateChange: (event) => {
              if (cancelled) return;
              const code = event.data;
              let nextStatus: PlayerStatus = 'idle';
              if (code === 1) nextStatus = 'playing';
              else if (code === 2) nextStatus = 'paused';
              else if (code === 3) nextStatus = 'buffering';
              else if (code === 0) nextStatus = 'ended';
              else if (code === -1 || code === 5) nextStatus = 'loading';

              setStatus(nextStatus);
              setErrorInfo(null);
              onStatusUpdateRef.current({
                playerStatus: nextStatus,
                playerErrorCode: null,
                playerErrorMessage: null
              });
            },
            onError: (event) => {
              if (cancelled) return;
              const errCode = event.data;
              const message = mapYouTubeErrorToTurkish(errCode);
              setStatus('error');
              setErrorInfo({ code: errCode, message });
              onStatusUpdateRef.current({
                playerStatus: 'error',
                playerErrorCode: errCode,
                playerErrorMessage: message
              });
              // Auto-open in external YouTube tab on embed restriction (101/150) so user doesn't need a 2nd step
              if (
                (errCode === 101 || errCode === 150) &&
                autoOpenedVideoIdRef.current !== currentVideoIdRef.current
              ) {
                autoOpenedVideoIdRef.current = currentVideoIdRef.current;
                onOpenExternalRef.current(currentVideoIdRef.current);
              }
            }
          }
        });
      });

      return () => {
        cancelled = true;
      };
    }, [video.videoId, initialMuted, initialVolume]);

    useEffect(() => {
      return () => {
        if (playerRef.current) {
          try {
            playerRef.current.destroy();
          } catch {
            // ignore destroy error
          }
          playerRef.current = null;
          isReadyRef.current = false;
        }
      };
    }, []);

    return (
      <div className="tv-player-stage">
        <div className="tv-player-header">
          <div className="tv-player-meta">
            <span className="tv-badge-live">YOUTUBE OYNATICI</span>
            <h2 className="tv-player-title">{video.title}</h2>
            <span className="tv-player-channel">{video.channelTitle}</span>
          </div>
          <div className="tv-player-actions">
            <button
              type="button"
              data-spatial-item="true"
              className="tv-btn tv-btn-secondary"
              onClick={() => onOpenExternalYouTube(video.videoId)}
            >
              ↗ YouTube Sekmesinde Aç
            </button>
            <button
              type="button"
              data-spatial-item="true"
              className="tv-btn tv-btn-primary"
              onClick={onReturnHome}
            >
              ⌂ Ana Ekrana Dön
            </button>
          </div>
        </div>

        <div className="tv-player-viewport-wrapper">
          <div ref={mountNodeRef} className="tv-player-iframe-container" />

          {status === 'loading' && !errorInfo && (
            <div className="tv-player-overlay">
              <div className="tv-spinner" />
              <p className="tv-overlay-title">Video Yükleniyor...</p>
              <p className="tv-overlay-sub">{video.title}</p>
            </div>
          )}

          {errorInfo && (
            <div className="tv-player-overlay tv-player-error-overlay" role="alert">
              <div className="tv-error-icon">⚠️</div>
              <h3 className="tv-overlay-title">Video Gömülü Olarak Oynatılamıyor</h3>
              <p className="tv-overlay-sub">{errorInfo.message}</p>
              <div className="tv-error-buttons">
                <button
                  type="button"
                  data-spatial-item="true"
                  className="tv-btn tv-btn-accent"
                  onClick={() => onOpenExternalYouTube(video.videoId)}
                >
                  ▶ YouTube Web Sitesinde Aç (Yeni Sekme)
                </button>
                <button
                  type="button"
                  data-spatial-item="true"
                  className="tv-btn tv-btn-secondary"
                  onClick={onReturnHome}
                >
                  ⌂ Ana Ekrana Dön
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);
