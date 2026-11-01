import type { NavigationDirection } from '../../shared/types.js';

const FOCUSABLE_SELECTOR = '[data-spatial-item="true"]';
const TOLERANCE = 4;
const PERPENDICULAR_WEIGHT = 2.5;

function isElementVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility();
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function getSpatialCandidates(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => !el.hasAttribute('disabled') && isElementVisible(el));
}

export function applyRovingTabIndex(container: HTMLElement, activeElement: HTMLElement): void {
  const candidates = getSpatialCandidates(container);
  for (const el of candidates) {
    el.setAttribute('tabindex', el === activeElement ? '0' : '-1');
  }
  activeElement.focus({ preventScroll: true });
  activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

/**
 * Selects the best next candidate in the requested 2D spatial direction using live
 * bounding client rects, edge-based direction filtering, perpendicular overlap preference,
 * and weighted fallback scoring.
 */
export function findNextSpatialCandidate(
  container: HTMLElement,
  current: HTMLElement,
  direction: Exclude<NavigationDirection, 'SELECT'>
): HTMLElement | null {
  const candidates = getSpatialCandidates(container).filter((el) => el !== current);
  if (candidates.length === 0) return null;

  const currentRect = current.getBoundingClientRect();
  const currentCenterX = currentRect.left + currentRect.width / 2;
  const currentCenterY = currentRect.top + currentRect.height / 2;

  interface ScoredCandidate {
    element: HTMLElement;
    overlapsPerpendicular: boolean;
    gap: number;
    perpOffset: number;
    weightedScore: number;
  }

  const validCandidates: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let inDirection = false;
    let gap = 0;
    let overlapsPerpendicular = false;
    let perpOffset = 0;

    switch (direction) {
      case 'RIGHT':
        inDirection = rect.left >= currentRect.right - TOLERANCE;
        gap = Math.max(0, rect.left - currentRect.right);
        overlapsPerpendicular =
          rect.bottom > currentRect.top + TOLERANCE && rect.top < currentRect.bottom - TOLERANCE;
        perpOffset = Math.abs(centerY - currentCenterY);
        break;

      case 'LEFT':
        inDirection = rect.right <= currentRect.left + TOLERANCE;
        gap = Math.max(0, currentRect.left - rect.right);
        overlapsPerpendicular =
          rect.bottom > currentRect.top + TOLERANCE && rect.top < currentRect.bottom - TOLERANCE;
        perpOffset = Math.abs(centerY - currentCenterY);
        break;

      case 'DOWN':
        inDirection = rect.top >= currentRect.bottom - TOLERANCE;
        gap = Math.max(0, rect.top - currentRect.bottom);
        overlapsPerpendicular =
          rect.right > currentRect.left + TOLERANCE && rect.left < currentRect.right - TOLERANCE;
        perpOffset = Math.abs(centerX - currentCenterX);
        break;

      case 'UP':
        inDirection = rect.bottom <= currentRect.top + TOLERANCE;
        gap = Math.max(0, currentRect.top - rect.bottom);
        overlapsPerpendicular =
          rect.right > currentRect.left + TOLERANCE && rect.left < currentRect.right - TOLERANCE;
        perpOffset = Math.abs(centerX - currentCenterX);
        break;
    }

    if (!inDirection) continue;

    validCandidates.push({
      element: candidate,
      overlapsPerpendicular,
      gap,
      perpOffset,
      weightedScore: gap + PERPENDICULAR_WEIGHT * perpOffset
    });
  }

  if (validCandidates.length === 0) {
    return null;
  }

  // Prefer aligned candidates that overlap on the perpendicular axis first
  const overlapping = validCandidates.filter((c) => c.overlapsPerpendicular);
  if (overlapping.length > 0) {
    overlapping.sort((a, b) => {
      if (Math.abs(a.gap - b.gap) > 1) return a.gap - b.gap;
      return a.perpOffset - b.perpOffset;
    });
    return overlapping[0].element;
  }

  // Weighted fallback scoring when jumping across rows/columns of different widths
  validCandidates.sort((a, b) => a.weightedScore - b.weightedScore);
  return validCandidates[0].element;
}

/**
 * Performs a directional focus step or triggers SELECT on the active candidate inside container.
 * Returns true if focus moved or an action was triggered.
 */
export function performSpatialNavigation(
  container: HTMLElement | null,
  direction: NavigationDirection
): boolean {
  if (!container) return false;

  const candidates = getSpatialCandidates(container);
  if (candidates.length === 0) return false;

  const activeEl = document.activeElement as HTMLElement | null;
  const current =
    activeEl && candidates.includes(activeEl)
      ? activeEl
      : candidates.find((el) => el.getAttribute('tabindex') === '0') ?? candidates[0];

  if (direction === 'SELECT') {
    current.focus({ preventScroll: true });
    current.click();
    return true;
  }

  if (!activeEl || !candidates.includes(activeEl)) {
    applyRovingTabIndex(container, current);
    return true;
  }

  const next = findNextSpatialCandidate(container, current, direction);
  if (!next) {
    return false;
  }

  applyRovingTabIndex(container, next);
  return true;
}

export function isEditableControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches(':read-write, select, input[type="range"], [role="slider"]');
}
