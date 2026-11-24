/**
 * Smart TV Dizi Takipçisi - Pre-roll Ad Skipper (Manifest V3 Content Script)
 *
 * Runs in all frames, but activates ONLY when the top-level tab is a supported
 * series site (verified via background.js) and the user has autoSkipAds enabled.
 *
 * Capabilities:
 *  - Detects and auto-clicks player pre-roll "Reklamı Geç / Skip Ad" buttons once active
 *  - Safely ignores countdown states ("5 sn", "3 saniye sonra") and external ad-link traps
 *  - Optionally mutes and speeds up confirmed short pre-roll ad <video> elements,
 *    and immediately restores audio/speed when the main episode begins
 *  - Arms popup-tab guard in background.js before clicking so ad popunders are closed
 */

(() => {
  const SKIP_SELECTORS = [
    '.jw-skip.jw-skippable',
    '.jw-skip:not(.jw-skip-disabled)',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-modern',
    '.vast-skip-button.enabled',
    '.vast-skip-button:not(.disabled)',
    '.vjs-skip-button',
    '.vjs-ad-skip',
    '.vjs-skip-ad',
    '.fluid_ad_skip_button',
    '#skip_button',
    '.skip_button',
    '.skip-button',
    '.skipButton',
    '.skipBtn',
    '.skip-btn',
    '.btn-skip',
    '#skipBtn',
    '#skip-btn',
    '#skipButton',
    '[class*="skip-ad" i]',
    '[class*="skip_ad" i]',
    '[class*="skipad" i]',
    '[class*="ad-skip" i]',
    '[class*="ad_skip" i]',
    '[class*="reklam-gec" i]',
    '[class*="reklam_gec" i]',
    '[class*="reklamgec" i]',
    '[id*="skip-ad" i]',
    '[id*="skip_ad" i]',
    '[id*="skipad" i]',
    '[id*="reklam-gec" i]',
    '[id*="reklam_gec" i]',
    '[id*="reklamgec" i]'
  ];

  const AD_STATE_SELECTORS = [
    '.jw-flag-ads',
    '.vjs-ad-playing',
    '.ad-showing',
    '.ad-interrupting',
    '.fluid_ad_playing',
    '.ima-ad-container',
    '.vast-blocker',
    '[class*="preroll" i]',
    '[id*="preroll" i]',
    '[class*="ad-playing" i]',
    '[class*="ad_playing" i]',
    '[class*="vast-ad" i]'
  ];

  const EXACT_SKIP_PHRASES = new Set([
    'reklami gec',
    'reklam gec',
    'reklami atla',
    'reklam atla',
    'reklami kapat',
    'reklam kapat',
    'videoya gec',
    'skip ad',
    'skip ads',
    'skip this ad',
    'skip video',
    'skip preroll',
    'skip pre-roll',
    'close ad'
  ]);

  const CONTEXTUAL_SKIP_PHRASES = new Set([
    'gec',
    'atla',
    'skip'
  ]);

  const NON_AD_SKIP_KEYWORDS = [
    'intro',
    'ozet',
    'bolum',
    'episode',
    'sonraki',
    'onceki',
    'next',
    'prev',
    'jenerik',
    'altyazi',
    'dublaj',
    'fragman',
    'sezon',
    'season'
  ];

  const AD_URL_PATTERN =
    /(?:^|[/._-])(preroll|pre-roll|vast|vpaid|advideo|reklam|doubleclick|googlesyndication|imasdk)(?:[/._-]|$)/i;

  const MAX_AD_VIDEO_DURATION_SEC = 95;
  const AD_PLAYBACK_RATE = 8;
  const ELEMENT_CLICK_COOLDOWN_MS = 1200;
  const SKIP_REPORT_DEBOUNCE_MS = 2500;

  /**
   * Normalizes Turkish and ASCII text for reliable case/diacritic-insensitive matching.
   */
  function normalizeText(raw) {
    if (typeof raw !== 'string') return '';
    return raw
      .replace(/İ/g, 'i')
      .replace(/I/g, 'i')
      .replace(/ı/g, 'i')
      .toLowerCase()
      .replace(/[ğ]/g, 'g')
      .replace(/[ü]/g, 'u')
      .replace(/[ş]/g, 's')
      .replace(/[ö]/g, 'o')
      .replace(/[ç]/g, 'c')
      .replace(/[»›><×✕✖|[\]()•·–—-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Returns true if text represents an active countdown/waiting state (must NOT click yet).
   */
  function isCountdownText(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    const norm = normalizeText(raw);
    if (!norm) return false;

    if (/\d/.test(norm)) {
      return true;
    }

    if (
      /\b(saniye|sn|bekle|bekleyin|kaldi|sonra|seconds?|sec|wait|skip in|can skip|gecebilirsiniz|atlayabilirsiniz)\b/.test(
        norm
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * Returns true if text looks like an active ad/countdown notice (even before skip is ready).
   */
  function isAdNoticeText(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    const norm = normalizeText(raw);
    if (!norm || norm.length > 70) return false;

    if (EXACT_SKIP_PHRASES.has(norm)) return true;
    if (
      /\breklam\w*\b/.test(norm) &&
      (/\d/.test(norm) || /\b(gec\w*|atla\w*|saniye|sn|kaldi|sonra|kapat\w*)\b/.test(norm))
    ) {
      return true;
    }
    if (/\bskip\b/.test(norm) && /\b(ad|ads|in|sec|seconds?)\b/.test(norm)) {
      return true;
    }
    return false;
  }

  /**
   * Returns true if normalized text is an actionable skip-ad label (and not an intro/episode button).
   */
  function isActionableSkipText(raw, hasAdContext = false) {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    if (isCountdownText(raw)) return false;

    const norm = normalizeText(raw);
    if (!norm || norm.length > 36) return false;

    if (NON_AD_SKIP_KEYWORDS.some((kw) => norm.includes(kw))) {
      return false;
    }

    if (EXACT_SKIP_PHRASES.has(norm)) {
      return true;
    }

    if (hasAdContext && CONTEXTUAL_SKIP_PHRASES.has(norm)) {
      return true;
    }

    return false;
  }

  /**
   * Rejects elements wrapped inside an external <a href="https://..."> link (common ad-click trap).
   */
  function isExternalLinkTrap(
    el,
    currentHostname = typeof window !== 'undefined' ? window.location.hostname : ''
  ) {
    if (!el || typeof el.closest !== 'function') return false;
    const anchor = el.closest('a[href]');
    if (!anchor) return false;

    const rawHref = (anchor.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || /^javascript:/i.test(rawHref)) {
      return false;
    }

    try {
      const baseHref =
        typeof window !== 'undefined' && window.location?.href
          ? window.location.href
          : `https://${currentHostname || 'localhost'}/`;
      const parsed = new URL(rawHref, baseHref);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      return parsed.hostname.toLowerCase() !== String(currentHostname || '').toLowerCase();
    } catch {
      return false;
    }
  }

  // Expose pure helpers for unit tests
  globalThis.__TV_CONTROLLER_AD_SKIPPER_HELPERS__ = {
    normalizeText,
    isCountdownText,
    isAdNoticeText,
    isActionableSkipText,
    isExternalLinkTrap
  };

  // Stop here if running outside a Chrome extension content script environment (e.g., Node/Vitest)
  if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
    return;
  }

  // Guard against duplicate injection in the same frame
  if (globalThis.__TV_CONTROLLER_AD_SKIPPER_INIT__) {
    return;
  }
  globalThis.__TV_CONTROLLER_AD_SKIPPER_INIT__ = true;

  let config = {
    enabled: false,
    muteAndSpeedUpAds: true,
    closeAdPopups: true
  };

  const clickedElements = new WeakMap();
  const modifiedVideos = new WeakMap();
  let lastReportedSkipAt = 0;
  let rafScheduled = false;
  let lastScanAt = 0;
  let fastPollUntil = 0;
  let pollTimerId = null;
  let observer = null;
  let isActive = false;

  async function safeSendMessage(payload) {
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch {
      return null;
    }
  }

  function getVisibleText(el) {
    if (!el) return '';
    const text = typeof el.innerText === 'string' && el.innerText.trim()
      ? el.innerText
      : el.textContent || el.getAttribute?.('aria-label') || el.value || '';
    return String(text).trim();
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden) return false;

    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.05) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width < 14 || rect.height < 12) return false;

    // Never treat a giant full-frame overlay as a skip button
    const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
    const vh = window.innerHeight || document.documentElement.clientHeight || 720;
    if (rect.width > vw * 0.85 && rect.height > vh * 0.85) return false;

    return true;
  }

  function isElementEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute?.('aria-disabled') === 'true') return false;

    const style = window.getComputedStyle(el);
    if (style && style.pointerEvents === 'none') return false;

    const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
    if (
      cls.includes('disabled') ||
      cls.includes('not-skippable') ||
      cls.includes('unskippable')
    ) {
      return false;
    }

    // JWPlayer uses .jw-skip without .jw-skippable while counting down
    if (cls.includes('jw-skip') && !cls.includes('jw-skippable') && !cls.includes('jw-skiptext')) {
      return false;
    }

    return true;
  }

  function queryAllWithShadow(selector, root = document, depth = 0, out = []) {
    if (!root || depth > 3) return out;
    try {
      const matched = root.querySelectorAll(selector);
      for (let i = 0; i < matched.length; i++) {
        out.push(matched[i]);
      }
      if (depth < 3) {
        const all = root.querySelectorAll('*');
        for (let i = 0; i < all.length; i++) {
          const sr = all[i].shadowRoot;
          if (sr) {
            queryAllWithShadow(selector, sr, depth + 1, out);
          }
        }
      }
    } catch {
      // Ignore invalid selector or closed shadow root errors
    }
    return out;
  }

  function hasAdStateInDom() {
    for (let i = 0; i < AD_STATE_SELECTORS.length; i++) {
      const matches = queryAllWithShadow(AD_STATE_SELECTORS[i]);
      for (let j = 0; j < matches.length; j++) {
        const el = matches[j];
        if (!el || !el.isConnected) continue;
        const style = window.getComputedStyle(el);
        if (style && style.display !== 'none' && style.visibility !== 'hidden') {
          return true;
        }
      }
    }
    return false;
  }

  function hasElementAdContext(el, frameHasAdState) {
    if (frameHasAdState) return true;
    let cur = el;
    for (let i = 0; i < 4 && cur; i++) {
      const idCls = `${cur.id || ''} ${typeof cur.className === 'string' ? cur.className : ''}`.toLowerCase();
      if (/(?:reklam|preroll|vast|ima|ad[-_]?skip|skip[-_]?ad|jw-skip|fluid_ad|vjs-ad)/.test(idCls)) {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  function resolveClickTarget(el) {
    if (!el || typeof el.closest !== 'function') return el;
    const interactive = el.closest(
      'button, [role="button"], .jw-skip, .videoAdUiSkipButton, .vast-skip-button, .fluid_ad_skip_button'
    );
    if (interactive && isElementVisible(interactive) && isElementEnabled(interactive) && !isExternalLinkTrap(interactive)) {
      return interactive;
    }
    return el;
  }

  function showSkipToast(message) {
    try {
      const hostId = 'tv-ctrl-adskip-toast';
      let toast = document.getElementById(hostId);
      if (!toast) {
        toast = document.createElement('div');
        toast.id = hostId;
        toast.setAttribute('aria-hidden', 'true');
        Object.assign(toast.style, {
          position: 'fixed',
          top: '16px',
          right: '16px',
          zIndex: '2147483647',
          padding: '8px 14px',
          borderRadius: '10px',
          background: 'rgba(15, 23, 42, 0.88)',
          color: '#f8fafc',
          border: '1px solid rgba(6, 182, 212, 0.45)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '13px',
          fontWeight: '600',
          letterSpacing: '0.2px',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
          pointerEvents: 'none',
          opacity: '0',
          transform: 'translateY(-6px)',
          transition: 'opacity 180ms ease, transform 180ms ease'
        });
        (document.body || document.documentElement).appendChild(toast);
      }

      toast.textContent = message;
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });

      clearTimeout(toast.__hideTimer);
      toast.__hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-6px)';
      }, 2200);
    } catch {
      // Ignore DOM append errors on restricted frames
    }
  }

  async function reportSkipped(method) {
    const now = Date.now();
    if (now - lastReportedSkipAt < SKIP_REPORT_DEBOUNCE_MS) {
      return;
    }
    lastReportedSkipAt = now;
    showSkipToast('⚡ Reklam otomatik geçildi');
    await safeSendMessage({ type: 'AD_SKIPPED', method });
  }

  async function clickSkipButton(rawEl) {
    const target = resolveClickTarget(rawEl);
    if (!target || !isElementVisible(target) || !isElementEnabled(target) || isExternalLinkTrap(target)) {
      return false;
    }

    const now = Date.now();
    const lastClicked = clickedElements.get(target) || 0;
    if (now - lastClicked < ELEMENT_CLICK_COOLDOWN_MS) {
      return false;
    }
    clickedElements.set(target, now);

    // Arm background popunder guard right before clicking
    if (config.closeAdPopups) {
      await safeSendMessage({ type: 'AD_SKIP_ARMED' });
    }

    try {
      const rect = target.getBoundingClientRect();
      const clientX = Math.round(rect.left + rect.width / 2);
      const clientY = Math.round(rect.top + rect.height / 2);
      const eventOpts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        button: 0
      };

      if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent('pointerdown', { ...eventOpts, pointerId: 1, pointerType: 'mouse' }));
      }
      target.dispatchEvent(new MouseEvent('mousedown', eventOpts));
      if (typeof PointerEvent === 'function') {
        target.dispatchEvent(new PointerEvent('pointerup', { ...eventOpts, pointerId: 1, pointerType: 'mouse' }));
      }
      target.dispatchEvent(new MouseEvent('mouseup', eventOpts));
      target.click();
    } catch {
      try {
        target.click();
      } catch {
        return false;
      }
    }

    boostPolling(8000);
    await reportSkipped('button');
    return true;
  }

  function findSkipCandidates(frameHasAdState) {
    const candidates = [];
    const seen = new Set();
    let countdownDetected = false;

    // 1. High-confidence known player selectors
    const combinedSelector = SKIP_SELECTORS.join(',');
    const selectorMatches = queryAllWithShadow(combinedSelector);
    for (let i = 0; i < selectorMatches.length; i++) {
      const el = selectorMatches[i];
      if (!el || seen.has(el)) continue;
      seen.add(el);
      if (!isElementVisible(el)) continue;

      const text = getVisibleText(el);
      if (isCountdownText(text)) {
        countdownDetected = true;
        continue;
      }

      if (isExternalLinkTrap(el)) continue;
      if (!isElementEnabled(el)) {
        if (isAdNoticeText(text)) countdownDetected = true;
        continue;
      }

      // If it has text, verify it is not a non-ad skip button ("Sonraki Bölüm", "Özeti Geç")
      if (text) {
        const norm = normalizeText(text);
        if (NON_AD_SKIP_KEYWORDS.some((kw) => norm.includes(kw))) {
          continue;
        }
      }

      candidates.push(el);
    }

    // 2. Text-based fallback scan for custom Turkish player wrappers
    const interactiveMatches = queryAllWithShadow('button, a, div, span, p, label, input[type="button"]');
    const maxScan = Math.min(interactiveMatches.length, 450);
    for (let i = 0; i < maxScan; i++) {
      const el = interactiveMatches[i];
      if (!el || seen.has(el)) continue;

      // Skip large wrapper containers with many descendants
      if (el.childElementCount > 3) continue;

      const text = getVisibleText(el);
      if (!text || text.length > 65) continue;

      if (isAdNoticeText(text) && isElementVisible(el)) {
        countdownDetected = true;
      }

      const adCtx = hasElementAdContext(el, frameHasAdState);
      if (!isActionableSkipText(text, adCtx)) continue;
      if (!isElementVisible(el) || !isElementEnabled(el) || isExternalLinkTrap(el)) continue;

      seen.add(el);
      candidates.push(el);
    }

    return { candidates, countdownDetected };
  }

  function restoreVideoState(video) {
    const saved = modifiedVideos.get(video);
    if (!saved) return;
    try {
      video.playbackRate = saved.playbackRate;
      video.muted = saved.muted;
    } catch {
      // Ignore if video element is detached
    }
    modifiedVideos.delete(video);
  }

  function restoreAllModifiedVideos() {
    const videos = queryAllWithShadow('video');
    for (let i = 0; i < videos.length; i++) {
      restoreVideoState(videos[i]);
    }
  }

  function isConfirmedAdVideo(video, frameHasAdEvidence) {
    if (!video || !video.isConnected) return false;
    const duration = video.duration;
    const hasFiniteDuration = Number.isFinite(duration) && duration > 0;

    // Never touch an episode-length video (> 95 seconds)
    if (hasFiniteDuration && duration > MAX_AD_VIDEO_DURATION_SEC) {
      return false;
    }

    const src = video.currentSrc || video.src || '';
    const hasAdUrl = Boolean(src && AD_URL_PATTERN.test(src));

    let inAdContainer = false;
    if (typeof video.closest === 'function') {
      inAdContainer = Boolean(
        video.closest(
          '.jw-flag-ads, .vjs-ad-playing, .ad-showing, .fluid_ad_playing, .ima-ad-container, [class*="preroll" i], [id*="preroll" i], [class*="vast" i]'
        )
      );
    }

    if (inAdContainer || hasAdUrl) {
      return !hasFiniteDuration || duration <= MAX_AD_VIDEO_DURATION_SEC;
    }

    // If frame shows an active ad/countdown notice AND this video is short (<= 95s)
    if (frameHasAdEvidence && hasFiniteDuration && duration <= MAX_AD_VIDEO_DURATION_SEC) {
      return true;
    }

    return false;
  }

  function handleAdVideos(frameHasAdEvidence) {
    const videos = queryAllWithShadow('video');
    let activeAdVideo = false;

    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      if (!video) continue;

      const isAd = config.muteAndSpeedUpAds && isConfirmedAdVideo(video, frameHasAdEvidence);
      const saved = modifiedVideos.get(video);

      if (isAd) {
        activeAdVideo = true;
        const currentSrc = video.currentSrc || video.src || '';

        if (!saved) {
          modifiedVideos.set(video, {
            muted: video.muted,
            playbackRate: video.playbackRate > 0 && video.playbackRate <= 4 ? video.playbackRate : 1,
            src: currentSrc
          });

          // Ensure immediate restoration when the player swaps src to the actual episode
          if (!video.__tvAdRestoreBound) {
            video.__tvAdRestoreBound = true;
            const onSourceChange = () => {
              const d = video.duration;
              if (Number.isFinite(d) && d > MAX_AD_VIDEO_DURATION_SEC) {
                restoreVideoState(video);
              }
            };
            video.addEventListener('loadedmetadata', onSourceChange);
            video.addEventListener('durationchange', onSourceChange);
            video.addEventListener('emptied', () => restoreVideoState(video));
          }
        }

        try {
          if (!video.muted) {
            video.muted = true;
          }
          if (!video.paused && !video.ended && Number.isFinite(video.duration) && video.duration > 0) {
            if (video.playbackRate < AD_PLAYBACK_RATE) {
              video.playbackRate = AD_PLAYBACK_RATE;
            }
          }
        } catch {
          // Some browsers restrict playbackRate on certain streams; muting still applies
        }
      } else if (saved) {
        restoreVideoState(video);
      }
    }

    return activeAdVideo;
  }

  async function scanFrame() {
    if (!config.enabled) {
      restoreAllModifiedVideos();
      return;
    }

    lastScanAt = Date.now();
    const frameHasAdState = hasAdStateInDom();
    const { candidates, countdownDetected } = findSkipCandidates(frameHasAdState);
    const frameHasAdEvidence = frameHasAdState || countdownDetected || candidates.length > 0;

    // 1. Auto-click any ready skip button first
    if (candidates.length > 0) {
      for (let i = 0; i < candidates.length; i++) {
        const clicked = await clickSkipButton(candidates[i]);
        if (clicked) {
          break;
        }
      }
    }

    // 2. Mute & speed up confirmed short ad videos while waiting for skip button
    const activeAdVideo = handleAdVideos(frameHasAdEvidence);

    if (countdownDetected || activeAdVideo || frameHasAdState) {
      boostPolling(12000);
    }
  }

  function scheduleScan() {
    if (!config.enabled || rafScheduled) return;
    const elapsed = Date.now() - lastScanAt;
    if (elapsed < 120) {
      return;
    }
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      scanFrame();
    });
  }

  function boostPolling(durationMs = 15000) {
    if (!config.enabled) return;
    fastPollUntil = Math.max(fastPollUntil, Date.now() + durationMs);
    if (!pollTimerId) {
      pollTimerId = setInterval(() => {
        if (!config.enabled || Date.now() > fastPollUntil) {
          clearInterval(pollTimerId);
          pollTimerId = null;
          return;
        }
        if (document.visibilityState === 'visible') {
          scanFrame();
        }
      }, 350);
    }
  }

  function startObserver() {
    if (isActive) return;
    isActive = true;

    observer = new MutationObserver(() => {
      scheduleScan();
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'disabled', 'hidden', 'aria-disabled'],
        characterData: true
      });
    }

    // Re-arm fast polling when user clicks play or interacts with the player
    document.addEventListener(
      'click',
      () => {
        boostPolling(20000);
      },
      true
    );

    // Re-arm fast polling when a video starts playing in this frame
    document.addEventListener(
      'play',
      (e) => {
        if (e.target && e.target.tagName === 'VIDEO') {
          boostPolling(20000);
          scheduleScan();
        }
      },
      true
    );

    boostPolling(30000);
    scanFrame();
  }

  function stopObserver() {
    isActive = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (pollTimerId) {
      clearInterval(pollTimerId);
      pollTimerId = null;
    }
    restoreAllModifiedVideos();
  }

  async function init() {
    const res = await safeSendMessage({ type: 'GET_AD_SKIPPER_CONFIG' });
    if (!res || !res.ok || !res.siteSupported) {
      // Not a supported series site — exit immediately with zero overhead
      return;
    }

    config = {
      enabled: Boolean(res.enabled),
      muteAndSpeedUpAds: res.muteAndSpeedUpAds !== false,
      closeAdPopups: res.closeAdPopups !== false
    };

    if (config.enabled) {
      startObserver();
    }

    // Live-react to toggle changes from popup/options without requiring page reload
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.autoSkipAds) {
          config.enabled = changes.autoSkipAds.newValue !== false;
          if (config.enabled) {
            startObserver();
          } else {
            stopObserver();
          }
        }
        if (changes.muteAndSpeedUpAds) {
          config.muteAndSpeedUpAds = changes.muteAndSpeedUpAds.newValue !== false;
          if (!config.muteAndSpeedUpAds) {
            restoreAllModifiedVideos();
          }
        }
        if (changes.closeAdPopups) {
          config.closeAdPopups = changes.closeAdPopups.newValue !== false;
        }
      });
    }
  }

  init();
})();
