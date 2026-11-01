/**
 * Smart TV Dizi Takipçisi - Content Script
 * Observes page navigation and title changes on series sites (including SPAs)
 */

(() => {
  let lastUrl = window.location.href;
  let lastTitle = document.title;

  function notifyChange() {
    const currentUrl = window.location.href;
    const currentTitle = document.title;
    if (currentUrl !== lastUrl || currentTitle !== lastTitle) {
      lastUrl = currentUrl;
      lastTitle = currentTitle;
      try {
        chrome.runtime.sendMessage({
          type: 'PAGE_UPDATED',
          url: currentUrl,
          title: currentTitle
        }).catch(() => {});
      } catch {
        // Extension context might be invalidated or unavailable
      }
    }
  }

  // Intercept history.pushState and history.replaceState for single-page applications
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    setTimeout(notifyChange, 150);
    setTimeout(notifyChange, 600); // SPAs may update document.title after route resolve
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    setTimeout(notifyChange, 150);
    setTimeout(notifyChange, 600);
  };

  window.addEventListener('popstate', () => {
    setTimeout(notifyChange, 150);
    setTimeout(notifyChange, 600);
  });

  // Watch for dynamic document.title changes via MutationObserver
  const titleEl = document.querySelector('title');
  if (titleEl) {
    const observer = new MutationObserver(() => {
      notifyChange();
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  // Initial check once document is ready
  setTimeout(notifyChange, 500);
})();
