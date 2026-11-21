/**
 * Smart TV Dizi Takipçisi - Content Script
 * Observes SPA navigation, title changes, visibility, and real <video> playback.
 */

(() => {
  const isTopFrame = window === window.top;
  let lastUrl = window.location.href;
  let lastTitle = document.title;

  // Video playback tracking state (per frame)
  let activeVideo = null;
  let lastVideoTime = 0;
  let watchedSeconds = 0;
  let nearEndReported = false;
  let endedReported = false;
  let lastHeartbeatAt = 0;

  function safeSendMessage(payload) {
    try {
      chrome.runtime.sendMessage(payload).catch(() => {});
    } catch {
      // Extension context might be invalidated or unavailable
    }
  }

  function getDomTitleHint() {
    if (!isTopFrame) return '';
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
    const h1Text = document.querySelector('h1')?.textContent?.trim() || '';
    return ogTitle || h1Text || '';
  }

  function notifyPageChange() {
    if (!isTopFrame) return;
    const currentUrl = window.location.href;
    const currentTitle = document.title;
    if (currentUrl !== lastUrl || currentTitle !== lastTitle) {
      lastUrl = currentUrl;
      lastTitle = currentTitle;
      // Reset per-navigation video tracking in top frame
      watchedSeconds = 0;
      lastVideoTime = 0;
      nearEndReported = false;
      endedReported = false;

      safeSendMessage({
        type: 'PAGE_UPDATED',
        url: currentUrl,
        title: currentTitle,
        domHint: getDomTitleHint()
      });
    }
  }

  function getVideoMetrics(video) {
    if (!video) {
      return {
        hasVideo: false,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        isNearEnd: false,
        ended: false
      };
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const isPlaying = !video.paused && !video.ended && video.readyState >= 2;
    const ended = Boolean(video.ended);
    const isNearEnd =
      duration >= 180 &&
      (currentTime / duration >= 0.92 || duration - currentTime <= 90);

    return {
      hasVideo: true,
      isPlaying,
      currentTime,
      duration,
      isNearEnd,
      ended
    };
  }

  function sendPlaybackHeartbeat(force = false) {
    const now = Date.now();
    if (!force && now - lastHeartbeatAt < 4500) {
      return;
    }
    lastHeartbeatAt = now;

    const video = activeVideo || document.querySelector('video');
    const metrics = getVideoMetrics(video);

    safeSendMessage({
      type: 'PLAYBACK_HEARTBEAT',
      isTopFrame,
      url: window.location.href,
      title: isTopFrame ? document.title : '',
      hasIframe: isTopFrame ? Boolean(document.querySelector('iframe')) : false,
      isVisible: document.visibilityState === 'visible',
      watchedSeconds: Math.floor(watchedSeconds),
      ...metrics
    });
  }

  function attachVideo(video) {
    if (!video || video.__tvControllerAttached) return;
    video.__tvControllerAttached = true;

    video.addEventListener('play', () => {
      activeVideo = video;
      lastVideoTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      sendPlaybackHeartbeat(true);
    });

    video.addEventListener('playing', () => {
      activeVideo = video;
      lastVideoTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      sendPlaybackHeartbeat(true);
    });

    video.addEventListener('pause', () => {
      sendPlaybackHeartbeat(true);
    });

    video.addEventListener('ended', () => {
      activeVideo = video;
      if (!endedReported) {
        endedReported = true;
        sendPlaybackHeartbeat(true);
      }
    });

    video.addEventListener('timeupdate', () => {
      activeVideo = video;
      if (video.paused || video.ended || video.readyState < 2) {
        lastVideoTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
        return;
      }

      const nowTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      const delta = nowTime - lastVideoTime;
      lastVideoTime = nowTime;

      // Only count normal forward playback (ignore seeks/skips)
      if (delta > 0 && delta <= 2.5 && document.visibilityState === 'visible') {
        watchedSeconds += delta;
      }

      const metrics = getVideoMetrics(video);
      if (metrics.isNearEnd && !nearEndReported) {
        nearEndReported = true;
        sendPlaybackHeartbeat(true);
      } else {
        sendPlaybackHeartbeat(false);
      }
    });
  }

  function scanVideos() {
    const videos = document.querySelectorAll('video');
    videos.forEach((v) => attachVideo(v));
  }

  // Initial scan and observer for dynamically injected <video> elements
  scanVideos();
  const rootObserver = new MutationObserver(() => {
    scanVideos();
  });
  if (document.documentElement) {
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Capture-phase fallback for shadow/custom players
  document.addEventListener(
    'play',
    (e) => {
      if (e.target && e.target.tagName === 'VIDEO') {
        attachVideo(e.target);
        activeVideo = e.target;
        sendPlaybackHeartbeat(true);
      }
    },
    true
  );

  if (isTopFrame) {
    // Intercept history.pushState and history.replaceState for single-page applications
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      setTimeout(notifyPageChange, 150);
      setTimeout(notifyPageChange, 600);
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      setTimeout(notifyPageChange, 150);
      setTimeout(notifyPageChange, 600);
    };

    window.addEventListener('popstate', () => {
      setTimeout(notifyPageChange, 150);
      setTimeout(notifyPageChange, 600);
    });

    // Watch for dynamic document.title changes via MutationObserver
    const titleEl = document.querySelector('title');
    if (titleEl) {
      const observer = new MutationObserver(() => {
        notifyPageChange();
      });
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    document.addEventListener('visibilitychange', () => {
      sendPlaybackHeartbeat(true);
    });

    // Periodic visible-tab heartbeat (supports cross-origin iframe fallback)
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        sendPlaybackHeartbeat(true);
      }
    }, 10000);

    // Initial check once document is ready
    setTimeout(() => {
      notifyPageChange();
      sendPlaybackHeartbeat(true);
    }, 500);
  }
})();
