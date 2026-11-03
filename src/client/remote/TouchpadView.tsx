import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  RotateCcw,
  RotateCw,
  Play,
  Maximize2,
  Volume1,
  Volume2,
  VolumeX,
  Keyboard,
  Send,
  CornerDownLeft,
  Delete,
  Settings,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Hand,
  X,
  Film
} from 'lucide-react';
import type { ValidatedClientMessage } from '../../shared/types.js';

interface TouchpadViewProps {
  sendCommand: (msg: ValidatedClientMessage) => void;
  triggerFeedback: (label: string) => void;
  activeSeriesTitle?: string;
  isMuted?: boolean;
  volume?: number;
}

export function TouchpadView({
  sendCommand,
  triggerFeedback,
  activeSeriesTitle,
  isMuted = false,
  volume = 80
}: TouchpadViewProps) {
  const [sensitivity, setSensitivity] = useState<number>(() => {
    try {
      const v = localStorage.getItem('tv_touchpad_sensitivity');
      return v ? parseFloat(v) : 1.2;
    } catch {
      return 1.2;
    }
  });
  const [invertScroll, setInvertScroll] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tv_touchpad_invert_scroll') === 'true';
    } catch {
      return false;
    }
  });
  const [useAcceleration, setUseAcceleration] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tv_touchpad_accel') !== 'false';
    } catch {
      return true;
    }
  });
  const [showScrollStrip, setShowScrollStrip] = useState<boolean>(() => {
    try {
      return localStorage.getItem('tv_touchpad_show_strip') !== 'false';
    } catch {
      return true;
    }
  });
  const [showSettingsSheet, setShowSettingsSheet] = useState<boolean>(false);
  const [showGestureGuide, setShowGestureGuide] = useState<boolean>(false);
  const [practiceFeedback, setPracticeFeedback] = useState<string>('Alana dokunarak jestleri deneyin');
  const [showVolumeCapsule, setShowVolumeCapsule] = useState<boolean>(false);
  const [showKeyboardSheet, setShowKeyboardSheet] = useState<boolean>(false);
  const [keyboardText, setKeyboardText] = useState<string>('');
  const keyboardInputRef = useRef<HTMLInputElement | null>(null);
  const volumeCapsuleRef = useRef<HTMLDivElement | null>(null);
  const [isDragLocked, setIsDragLocked] = useState<boolean>(false);
  const [touchIndicator, setTouchIndicator] = useState<{ x: number; y: number } | null>(null);

  // References for touch tracking and RAF batching
  const padRef = useRef<HTMLDivElement | null>(null);
  const scrollStripRef = useRef<HTMLDivElement | null>(null);

  const pendingDxRef = useRef<number>(0);
  const pendingDyRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);

  const touchStartTimeRef = useRef<number>(0);
  const touchStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchCurrentPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchFingerCountRef = useRef<number>(0);
  const touchMovedDistRef = useRef<number>(0);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapTimeRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);

  // Flush accumulated mouse movements to server at 60fps
  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const dx = Math.round(pendingDxRef.current);
      const dy = Math.round(pendingDyRef.current);
      if (dx !== 0 || dy !== 0) {
        sendCommand({
          type: 'MOUSE_MOVE',
          dx,
          dy
        });
        pendingDxRef.current -= dx;
        pendingDyRef.current -= dy;
      }
    });
  }, [sendCommand]);

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Scroll deltas are accumulated and flushed once per frame (instead of one WS message per touchmove)
  const multiTouchRef = useRef<boolean>(false);
  const pendingScrollXRef = useRef<number>(0);
  const pendingScrollYRef = useRef<number>(0);
  const scrollRafRef = useRef<number | null>(null);

  const flushScroll = () => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    const deltaY = Math.round(pendingScrollYRef.current);
    const deltaX = Math.round(pendingScrollXRef.current);
    if (deltaY === 0 && deltaX === 0) return;
    pendingScrollYRef.current -= deltaY;
    pendingScrollXRef.current -= deltaX;
    sendCommand({
      type: 'MOUSE_SCROLL',
      deltaY,
      ...(deltaX !== 0 ? { deltaX } : {})
    });
  };
  const flushScrollRef = useRef(flushScroll);
  flushScrollRef.current = flushScroll;

  const queueScroll = (dx: number, dy: number, baseFactor = 4) => {
    const factor = invertScroll ? -baseFactor : baseFactor;
    pendingScrollXRef.current += dx * factor;
    pendingScrollYRef.current += dy * factor;
    if (scrollRafRef.current === null) {
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        flushScrollRef.current();
      });
    }
  };

  const handlePadTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    touchFingerCountRef.current = Math.max(touchFingerCountRef.current, touches.length);
    if (touches.length >= 2) {
      // Once a second finger lands, the whole gesture is a scroll/right-tap until all fingers lift
      multiTouchRef.current = true;
      cancelLongPress();
      setTouchIndicator(null);
      const midX = (touches[0].clientX + touches[1].clientX) / 2;
      const midY = (touches[0].clientY + touches[1].clientY) / 2;
      touchCurrentPosRef.current = { x: midX, y: midY };
      return;
    }

    multiTouchRef.current = false;
    touchFingerCountRef.current = touches.length;
    touchStartTimeRef.current = Date.now();
    touchMovedDistRef.current = 0;

    const primary = touches[0];
    const rect = padRef.current?.getBoundingClientRect();
    if (primary && rect) {
      const relX = primary.clientX - rect.left;
      const relY = primary.clientY - rect.top;
      touchStartPosRef.current = { x: primary.clientX, y: primary.clientY };
      touchCurrentPosRef.current = { x: primary.clientX, y: primary.clientY };
      setTouchIndicator({ x: relX, y: relY });
    }

    cancelLongPress();

    // Check for double-tap drag (second tap within 300ms)
    const now = Date.now();
    const timeSinceLastTap = now - lastTapTimeRef.current;
    if (touches.length === 1 && timeSinceLastTap < 300) {
      isDraggingRef.current = true;
      sendCommand({ type: 'MOUSE_DOWN', button: 'left' });
      return;
    }

    // Single finger long-press triggers Right Click (one-handed App Store pattern)
    if (touches.length === 1 && !isDragLocked) {
      longPressTimerRef.current = setTimeout(() => {
        if (touchMovedDistRef.current < 10) {
          try {
            navigator.vibrate?.(35);
          } catch {
            // ignore
          }
          sendCommand({ type: 'MOUSE_CLICK', button: 'right' });
          setTouchIndicator(null);
        }
      }, 380);
    }
  };

  const handlePadTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;

    if (touches.length === 1 && !multiTouchRef.current) {
      const touch = touches[0];
      const dx = touch.clientX - touchCurrentPosRef.current.x;
      const dy = touch.clientY - touchCurrentPosRef.current.y;
      touchCurrentPosRef.current = { x: touch.clientX, y: touch.clientY };

      const moveDist = Math.hypot(
        touch.clientX - touchStartPosRef.current.x,
        touch.clientY - touchStartPosRef.current.y
      );
      touchMovedDistRef.current = moveDist;

      if (moveDist > 8) {
        cancelLongPress();
      }

      // Update indicator position for visual feedback
      const rect = padRef.current?.getBoundingClientRect();
      if (rect) {
        setTouchIndicator({
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top
        });
      }

      // Velocity acceleration curve: slow movements are pixel-precise; fast flicks cover TV screens
      const speed = Math.hypot(dx, dy);
      const accel = useAcceleration ? 1 + Math.min(speed / 9, 2.2) : 1;
      pendingDxRef.current += dx * sensitivity * accel;
      pendingDyRef.current += dy * sensitivity * accel;
      scheduleFlush();
    } else if (touches.length >= 2) {
      // Two-finger scroll (laptop trackpad standard), tracked via the midpoint of both fingers
      cancelLongPress();
      setTouchIndicator(null);
      const midX = (touches[0].clientX + touches[1].clientX) / 2;
      const midY = (touches[0].clientY + touches[1].clientY) / 2;
      const dy = midY - touchCurrentPosRef.current.y;
      const dx = midX - touchCurrentPosRef.current.x;
      touchCurrentPosRef.current = { x: midX, y: midY };
      touchMovedDistRef.current += Math.hypot(dx, dy);
      queueScroll(dx, dy);
    }
  };

  const handlePadTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    // Wait until every finger has lifted before resolving the gesture
    if (e.touches.length > 0) return;

    cancelLongPress();
    setTouchIndicator(null);
    flushScroll();

    const now = Date.now();
    const duration = now - touchStartTimeRef.current;
    const moved = touchMovedDistRef.current;
    const fingers = touchFingerCountRef.current;
    multiTouchRef.current = false;
    touchFingerCountRef.current = 0;

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      sendCommand({ type: 'MOUSE_UP', button: 'left' });
      lastTapTimeRef.current = 0;
      return;
    }

    // Tap detection: short duration and minimal movement
    if (e.type !== 'touchcancel' && moved < 9 && duration < 280) {
      if (fingers === 1) {
        sendCommand({ type: 'MOUSE_CLICK', button: 'left' });
        lastTapTimeRef.current = now;
      } else if (fingers === 2) {
        try {
          navigator.vibrate?.(25);
        } catch {
          // ignore
        }
        sendCommand({ type: 'MOUSE_CLICK', button: 'right' });
        lastTapTimeRef.current = 0;
      }
    } else {
      lastTapTimeRef.current = 0;
    }
  };

  // Right-Side One-Handed Scroll Strip Touch Handlers
  const scrollLastYRef = useRef<number>(0);
  const handleScrollStripStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches[0]) {
      scrollLastYRef.current = e.touches[0].clientY;
    }
  };

  const handleScrollStripMove = (e: TouchEvent) => {
    e.preventDefault();
    if (!e.touches[0]) return;
    const currentY = e.touches[0].clientY;
    const dy = currentY - scrollLastYRef.current;
    scrollLastYRef.current = currentY;
    queueScroll(0, dy, 15);
  };

  // React registers touch listeners as passive, which makes preventDefault() a no-op and lets
  // the browser hijack the gesture (touchcancel). Attach native non-passive listeners instead.
  const latestHandlersRef = useRef({
    padStart: handlePadTouchStart,
    padMove: handlePadTouchMove,
    padEnd: handlePadTouchEnd,
    stripStart: handleScrollStripStart,
    stripMove: handleScrollStripMove
  });
  latestHandlersRef.current = {
    padStart: handlePadTouchStart,
    padMove: handlePadTouchMove,
    padEnd: handlePadTouchEnd,
    stripStart: handleScrollStripStart,
    stripMove: handleScrollStripMove
  };

  useEffect(() => {
    const pad = padRef.current;
    const strip = scrollStripRef.current;
    if (!pad) return;
    const opts: AddEventListenerOptions = { passive: false };

    const onPadStart = (e: TouchEvent) => latestHandlersRef.current.padStart(e);
    const onPadMove = (e: TouchEvent) => latestHandlersRef.current.padMove(e);
    const onPadEnd = (e: TouchEvent) => latestHandlersRef.current.padEnd(e);

    pad.addEventListener('touchstart', onPadStart, opts);
    pad.addEventListener('touchmove', onPadMove, opts);
    pad.addEventListener('touchend', onPadEnd, opts);
    pad.addEventListener('touchcancel', onPadEnd, opts);

    let onStripStart: ((e: TouchEvent) => void) | null = null;
    let onStripMove: ((e: TouchEvent) => void) | null = null;
    let onStripEnd: ((e: TouchEvent) => void) | null = null;

    if (strip) {
      onStripStart = (e: TouchEvent) => latestHandlersRef.current.stripStart(e);
      onStripMove = (e: TouchEvent) => latestHandlersRef.current.stripMove(e);
      onStripEnd = (e: TouchEvent) => {
        e.preventDefault();
        flushScrollRef.current();
      };
      strip.addEventListener('touchstart', onStripStart, opts);
      strip.addEventListener('touchmove', onStripMove, opts);
      strip.addEventListener('touchend', onStripEnd, opts);
      strip.addEventListener('touchcancel', onStripEnd, opts);
    }

    return () => {
      pad.removeEventListener('touchstart', onPadStart);
      pad.removeEventListener('touchmove', onPadMove);
      pad.removeEventListener('touchend', onPadEnd);
      pad.removeEventListener('touchcancel', onPadEnd);
      if (strip && onStripStart && onStripMove && onStripEnd) {
        strip.removeEventListener('touchstart', onStripStart);
        strip.removeEventListener('touchmove', onStripMove);
        strip.removeEventListener('touchend', onStripEnd);
        strip.removeEventListener('touchcancel', onStripEnd);
      }
    };
  }, [showScrollStrip]);

  // Desktop Pointer / Mouse Event Handlers (for laptop and desktop testing)
  const isPointerDraggingRef = useRef<boolean>(false);
  const pointerLastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerStartTimeRef = useRef<number>(0);
  const pointerStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handlePadPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Touch devices are handled with 60fps native non-passive touch listeners & gestures
    if (e.pointerType === 'touch') return;
    if (e.button === 2) {
      // Right click
      sendCommand({ type: 'MOUSE_CLICK', button: 'right' });
      return;
    }
    if (e.button !== 0) return;

    isPointerDraggingRef.current = true;
    pointerStartTimeRef.current = Date.now();
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    pointerLastPosRef.current = { x: e.clientX, y: e.clientY };

    const rect = padRef.current?.getBoundingClientRect();
    if (rect) {
      setTouchIndicator({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePadPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || !isPointerDraggingRef.current) return;
    const dx = e.clientX - pointerLastPosRef.current.x;
    const dy = e.clientY - pointerLastPosRef.current.y;
    pointerLastPosRef.current = { x: e.clientX, y: e.clientY };

    const rect = padRef.current?.getBoundingClientRect();
    if (rect) {
      setTouchIndicator({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }

    const speed = Math.hypot(dx, dy);
    const accel = useAcceleration ? 1 + Math.min(speed / 9, 2.2) : 1;
    pendingDxRef.current += dx * sensitivity * accel;
    pendingDyRef.current += dy * sensitivity * accel;
    scheduleFlush();
  };

  const handlePadPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    if (!isPointerDraggingRef.current) return;
    isPointerDraggingRef.current = false;
    setTouchIndicator(null);

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}

    const dist = Math.hypot(
      e.clientX - pointerStartPosRef.current.x,
      e.clientY - pointerStartPosRef.current.y
    );
    const duration = Date.now() - pointerStartTimeRef.current;
    if (dist < 6 && duration < 300) {
      sendCommand({ type: 'MOUSE_CLICK', button: 'left' });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const dy = -Math.round(e.deltaY / 2);
    const dx = -Math.round(e.deltaX / 2);
    queueScroll(dx, dy, 1);
  };

  // Drag lock toggle (keeps left mouse button pressed)
  const toggleDragLock = () => {
    const nextState = !isDragLocked;
    setIsDragLocked(nextState);
    if (nextState) {
      sendCommand({ type: 'MOUSE_DOWN', button: 'left' });
      triggerFeedback('Sürükleme Kilidi Açık (Basılı)');
    } else {
      sendCommand({ type: 'MOUSE_UP', button: 'left' });
      triggerFeedback('Sürükleme Kilidi Kapandı');
    }
  };

  const handleSensitivityChange = (newVal: number) => {
    setSensitivity(newVal);
    try {
      localStorage.setItem('tv_touchpad_sensitivity', String(newVal));
    } catch {
      // ignore
    }
  };

  const handleInvertScrollToggle = () => {
    setInvertScroll((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tv_touchpad_invert_scroll', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleAccelToggle = () => {
    setUseAcceleration((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tv_touchpad_accel', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const handleScrollStripToggle = () => {
    setShowScrollStrip((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tv_touchpad_show_strip', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  useEffect(() => {
    return () => {
      cancelLongPress();
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (isDragLocked) {
        sendCommand({ type: 'MOUSE_UP', button: 'left' });
      }
    };
  }, [isDragLocked, sendCommand]);

  // Auto-focus text input when keyboard sheet opens
  useEffect(() => {
    if (showKeyboardSheet) {
      const timer = setTimeout(() => {
        keyboardInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showKeyboardSheet]);

  // Close volume capsule on outside clicks
  useEffect(() => {
    if (!showVolumeCapsule) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (
        volumeCapsuleRef.current &&
        !volumeCapsuleRef.current.contains(target) &&
        !target.closest('.touchpad-volume-trigger')
      ) {
        setShowVolumeCapsule(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [showVolumeCapsule]);

  return (
    <div className="touchpad-container">
      {/* 1. Quick Series & Video Controls Bar (Sleek Floating Capsule) */}
      <div className="touchpad-media-bar">
        {activeSeriesTitle && (
          <div className="touchpad-series-label" title={activeSeriesTitle}>
            <Film size={14} strokeWidth={2.2} /> <span>{activeSeriesTitle}</span>
          </div>
        )}
        <div className="touchpad-media-buttons">
          <button
            type="button"
            className="touchpad-media-btn"
            title="10 Saniye Geri Sar"
            onClick={() => {
              sendCommand({ type: 'KEY_PRESS', key: 'LEFT' });
              triggerFeedback('10 sn Geri');
            }}
          >
            <RotateCcw size={15} strokeWidth={2.2} />
            <span>10s</span>
          </button>

          <button
            type="button"
            className="touchpad-media-btn touchpad-media-btn-primary"
            title="Diziyi Oynat / Durdur (Space & Media Key)"
            onClick={() => {
              sendCommand({ type: 'KEY_PRESS', key: 'SPACE' });
              triggerFeedback('Oynat / Durdur');
            }}
          >
            <Play size={15} strokeWidth={2.2} fill="currentColor" />
            <span>Oynat</span>
          </button>

          <button
            type="button"
            className="touchpad-media-btn"
            title="10 Saniye İleri Sar"
            onClick={() => {
              sendCommand({ type: 'KEY_PRESS', key: 'RIGHT' });
              triggerFeedback('10 sn İleri');
            }}
          >
            <RotateCw size={15} strokeWidth={2.2} />
            <span>10s</span>
          </button>

          <button
            type="button"
            className="touchpad-media-btn"
            title="Tam Ekran Aç / Kapat (F)"
            onClick={() => {
              sendCommand({ type: 'KEY_PRESS', key: 'F' });
              triggerFeedback('Tam Ekran');
            }}
          >
            <Maximize2 size={16} strokeWidth={2.2} />
          </button>

          <button
            type="button"
            className={`touchpad-media-btn touchpad-volume-trigger ${isMuted ? 'is-muted-active' : ''} ${showVolumeCapsule ? 'is-active-capsule' : ''}`}
            title="Ses Kontrolü & Kapsül"
            onClick={() => {
              setShowVolumeCapsule((prev) => !prev);
              setShowKeyboardSheet(false);
            }}
          >
            {isMuted ? <VolumeX size={16} strokeWidth={2.2} /> : <Volume2 size={16} strokeWidth={2.2} />}
          </button>

          <button
            type="button"
            className={`touchpad-media-btn touchpad-keyboard-trigger ${showKeyboardSheet ? 'is-active-capsule' : ''}`}
            title="Telefondan PC'ye Klavye & Metin Gönder"
            onClick={() => {
              setShowKeyboardSheet(true);
              setShowVolumeCapsule(false);
            }}
          >
            <Keyboard size={16} strokeWidth={2.2} />
          </button>

          <button
            type="button"
            className="touchpad-media-btn touchpad-settings-trigger"
            title="Hassasiyet & Touchpad Ayarları"
            onClick={() => {
              setShowSettingsSheet(true);
              setShowVolumeCapsule(false);
              setShowKeyboardSheet(false);
            }}
          >
            <Settings size={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* Floating Volume Capsule Popover */}
      {showVolumeCapsule && (
        <div ref={volumeCapsuleRef} className="touchpad-volume-capsule">
          <div className="touchpad-capsule-row">
            <button
              type="button"
              className={`touchpad-capsule-btn ${isMuted ? 'is-muted-active' : ''}`}
              title={isMuted ? 'Sesi Aç' : 'Sessize Al'}
              onClick={() => {
                sendCommand({ type: 'COMMAND', action: 'TOGGLE_MUTE' });
                triggerFeedback(isMuted ? 'Ses Açık' : 'Sessiz');
              }}
            >
              {isMuted ? <VolumeX size={16} strokeWidth={2.2} /> : <Volume2 size={16} strokeWidth={2.2} />}
            </button>

            <button
              type="button"
              className="touchpad-capsule-btn"
              title="Sesi 10 Azalt"
              onClick={() => {
                sendCommand({ type: 'ADJUST_VOLUME', delta: -10 });
                triggerFeedback('Ses -10');
              }}
            >
              <Volume1 size={14} strokeWidth={2} />
              <span>-10</span>
            </button>

            <div className="touchpad-capsule-slider-wrap">
              <input
                type="range"
                min="0"
                max="100"
                step="2"
                value={volume}
                className="touchpad-capsule-slider"
                onChange={(e) => {
                  sendCommand({ type: 'SET_VOLUME', volume: Number(e.target.value) });
                }}
              />
              <span className="touchpad-capsule-pct">%{volume}</span>
            </div>

            <button
              type="button"
              className="touchpad-capsule-btn"
              title="Sesi 10 Artır"
              onClick={() => {
                sendCommand({ type: 'ADJUST_VOLUME', delta: 10 });
                triggerFeedback('Ses +10');
              }}
            >
              <Volume2 size={14} strokeWidth={2} />
              <span>+10</span>
            </button>

            <button
              type="button"
              className="touchpad-capsule-close"
              title="Kapat"
              onClick={() => setShowVolumeCapsule(false)}
            >
              <X size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      )}

      {/* 2. Full-Height Touchpad Surface + Floating Overlay Scroll Strip */}
      <div className="touchpad-surface-row">
        {/* Large Edge-to-Edge Touchpad Area */}
        <div
          ref={padRef}
          className="touchpad-surface"
          onPointerDown={handlePadPointerDown}
          onPointerMove={handlePadPointerMove}
          onPointerUp={handlePadPointerUp}
          onPointerCancel={handlePadPointerUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          {touchIndicator && (
            <div
              className="touchpad-ripple"
              style={{
                left: `${touchIndicator.x}px`,
                top: `${touchIndicator.y}px`
              }}
            />
          )}

          <div className="touchpad-hint">
            <span className="touchpad-hint-icon"><Sparkles size={14} strokeWidth={2.2} /></span>
            <span>Kaydır: İmleç &bull; Dokun: Sol Tık &bull; 2 Parmak: Sağ Tık &bull; Çift Dokun: Sürükle</span>
          </div>

          {/* Floating Right-Side Scroll Strip (Transparent Overlay) */}
          {showScrollStrip && (
            <div
              ref={scrollStripRef}
              className="touchpad-scroll-strip"
              title="Tek Başparmakla Dikey Sayfa Kaydırma Şeridi"
              onWheel={handleWheel}
            >
              <div className="touchpad-scroll-label"><ChevronUp size={12} strokeWidth={2.5} /></div>
              <div className="touchpad-scroll-thumb">SCROLL</div>
              <div className="touchpad-scroll-label"><ChevronDown size={12} strokeWidth={2.5} /></div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Ergonomic Asymmetric Bottom Mouse Buttons */}
      <div className="touchpad-buttons-row">
        <button
          type="button"
          className="touchpad-btn touchpad-btn-left"
          onClick={() => {
            sendCommand({ type: 'MOUSE_CLICK', button: 'left' });
          }}
        >
          Sol Tık
        </button>

        <button
          type="button"
          className="touchpad-btn touchpad-btn-right"
          onClick={() => {
            try {
              navigator.vibrate?.(25);
            } catch {
              // ignore
            }
            sendCommand({ type: 'MOUSE_CLICK', button: 'right' });
          }}
        >
          Sağ Tık
        </button>

        <button
          type="button"
          className={`touchpad-btn touchpad-btn-lock ${isDragLocked ? 'is-active-lock' : ''}`}
          onClick={toggleDragLock}
          title={isDragLocked ? 'Sürüklemeyi Bırak' : 'Pencere veya Metin Sürükleme Kilidi'}
        >
          <Hand size={14} strokeWidth={2.2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} />
          <span>{isDragLocked ? 'Bırak' : 'Sürükle'}</span>
        </button>
      </div>

      {/* 4. Settings Drawer / Bottom Sheet Modal */}
      {showSettingsSheet && (
        <div className="touchpad-sheet-backdrop" onClick={() => setShowSettingsSheet(false)}>
          <div className="touchpad-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="touchpad-sheet-handle" />
            <div className="touchpad-sheet-header">
              <div className="touchpad-sheet-title">
                <Settings size={18} strokeWidth={2.2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
                <span>Touchpad & Mouse Ayarları</span>
              </div>
              <button
                type="button"
                className="touchpad-sheet-close"
                onClick={() => setShowSettingsSheet(false)}
                aria-label="Kapat"
              >
                <X size={18} strokeWidth={2.5} />
              </button>
            </div>

            <div className="touchpad-sheet-content">
              {/* Sensitivity Slider + Presets */}
              <div className="touchpad-sheet-group">
                <div className="touchpad-sheet-label-row">
                  <span>İmleç Hassasiyeti</span>
                  <strong>{sensitivity.toFixed(1)}x</strong>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.1"
                  value={sensitivity}
                  className="touchpad-sheet-slider"
                  onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
                />
                <div className="touchpad-sheet-chips">
                  <button
                    type="button"
                    className={`touchpad-setting-chip ${Math.abs(sensitivity - 0.8) < 0.05 ? 'is-selected' : ''}`}
                    onClick={() => handleSensitivityChange(0.8)}
                  >
                    Yavaş (0.8x)
                  </button>
                  <button
                    type="button"
                    className={`touchpad-setting-chip ${Math.abs(sensitivity - 1.2) < 0.05 ? 'is-selected' : ''}`}
                    onClick={() => handleSensitivityChange(1.2)}
                  >
                    Normal (1.2x)
                  </button>
                  <button
                    type="button"
                    className={`touchpad-setting-chip ${Math.abs(sensitivity - 1.8) < 0.05 ? 'is-selected' : ''}`}
                    onClick={() => handleSensitivityChange(1.8)}
                  >
                    Hızlı (1.8x)
                  </button>
                  <button
                    type="button"
                    className={`touchpad-setting-chip ${Math.abs(sensitivity - 2.2) < 0.05 ? 'is-selected' : ''}`}
                    onClick={() => handleSensitivityChange(2.2)}
                  >
                    TV / Uzak (2.2x)
                  </button>
                </div>
              </div>

              {/* Toggles */}
              <div className="touchpad-sheet-toggles">
                <div className="touchpad-toggle-row">
                  <div className="touchpad-toggle-text">
                    <strong>Doğal Kaydırma (Scroll)</strong>
                    <small>{invertScroll ? 'Ters (Windows Klasik tekerlek)' : 'Doğal (iOS / macOS parmak yönü)'}</small>
                  </div>
                  <button
                    type="button"
                    className={`touchpad-switch ${!invertScroll ? 'is-on' : ''}`}
                    onClick={handleInvertScrollToggle}
                    aria-label="Doğal Kaydırma Değiştir"
                  >
                    <span className="touchpad-switch-thumb" />
                  </button>
                </div>

                <div className="touchpad-toggle-row">
                  <div className="touchpad-toggle-text">
                    <strong>İmleç İvmelenmesi (Hızlanma)</strong>
                    <small>Fiske hareketlerinde imleç TV ekranında daha hızlı yol alır</small>
                  </div>
                  <button
                    type="button"
                    className={`touchpad-switch ${useAcceleration ? 'is-on' : ''}`}
                    onClick={handleAccelToggle}
                    aria-label="İmleç İvmelenmesi Değiştir"
                  >
                    <span className="touchpad-switch-thumb" />
                  </button>
                </div>

                <div className="touchpad-toggle-row">
                  <div className="touchpad-toggle-text">
                    <strong>Sağ Kenar Kaydırma Şeridi</strong>
                    <small>Tek başparmakla dikey kaydırma için kenar çubuğu</small>
                  </div>
                  <button
                    type="button"
                    className={`touchpad-switch ${showScrollStrip ? 'is-on' : ''}`}
                    onClick={handleScrollStripToggle}
                    aria-label="Kaydırma Şeridi Göster/Gizle"
                  >
                    <span className="touchpad-switch-thumb" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="touchpad-open-guide-btn"
                onClick={() => {
                  setShowSettingsSheet(false);
                  setShowGestureGuide(true);
                }}
              >
                <Sparkles size={16} strokeWidth={2.2} />
                <span>Animasyonlu Jest Rehberini Aç</span>
              </button>

              {/* Gesture Cheat Sheet */}
              <div className="touchpad-gesture-guide">
                <div className="touchpad-guide-title">
                  <Sparkles size={14} strokeWidth={2.2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} />
                  Kullanışlı Jestler
                </div>
                <div className="touchpad-guide-item"><span>Tek Parmak Kaydır:</span> İmleç Hareketi</div>
                <div className="touchpad-guide-item"><span>Tek Parmak Dokun:</span> Sol Tık</div>
                <div className="touchpad-guide-item"><span>İki Parmak Dokun:</span> Sağ Tık</div>
                <div className="touchpad-guide-item"><span>İki Parmak Kaydır:</span> Pürüzsüz Sayfa Kaydırma</div>
                <div className="touchpad-guide-item"><span>Tek Parmak Basılı Tut:</span> Sağ Tık Menüsü</div>
                <div className="touchpad-guide-item"><span>Çift Dokun ve Sürükle:</span> Pencere / Metin Taşı</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4.5 Stageshow-Craft Animated Gesture Guide Modal */}
      {showGestureGuide && (
        <div className="touchpad-sheet-backdrop" onClick={() => setShowGestureGuide(false)}>
          <div className="touchpad-sheet touchpad-gesture-guide-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="touchpad-sheet-handle" />
            <div className="touchpad-sheet-header">
              <div className="touchpad-sheet-title">
                <Sparkles size={18} strokeWidth={2.2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
                <span>Dokunmatik Jest & Hareket Rehberi</span>
              </div>
              <button
                type="button"
                className="touchpad-sheet-close"
                onClick={() => setShowGestureGuide(false)}
                aria-label="Kapat"
              >
                <X size={18} strokeWidth={2.5} />
              </button>
            </div>

            <div className="touchpad-sheet-content">
              {/* Practice Canvas Sandbox */}
              <div
                className="gesture-practice-box"
                onTouchStart={() => setPracticeFeedback('Dokunma Başladı...')}
                onTouchEnd={(e) => {
                  if (e.changedTouches.length >= 2) {
                    setPracticeFeedback('✓ İki Parmak Dokunuldu (Sağ Tık)');
                  } else {
                    setPracticeFeedback('✓ Tek Dokunuş (Sol Tık)');
                  }
                }}
                onTouchMove={(e) => {
                  if (e.touches.length >= 2) {
                    setPracticeFeedback('✓ İki Parmakla Kaydırma (Scroll)');
                  } else {
                    setPracticeFeedback('✓ İmleç Geziniyor');
                  }
                }}
              >
                <div className="gesture-practice-pill">{practiceFeedback}</div>
                <small>Burada parmağınızla serbestçe jestleri test edebilirsiniz</small>
              </div>

              {/* 5 Animated Gesture Cards */}
              <div className="gesture-cards-list">
                <div className="gesture-card-row">
                  <div className="gesture-card-anim anim-tap">
                    <div className="anim-finger-dot" />
                    <div className="anim-tap-ripple" />
                  </div>
                  <div className="gesture-card-desc">
                    <strong>1. Tek Dokunuş (Sol Tık)</strong>
                    <p>Parmağınızla ekrana bir kez dokunup çekin. Butonları ve bağlantıları tıklar.</p>
                  </div>
                </div>

                <div className="gesture-card-row">
                  <div className="gesture-card-anim anim-scroll">
                    <div className="anim-finger-pair">
                      <div className="anim-finger-dot" />
                      <div className="anim-finger-dot" />
                    </div>
                  </div>
                  <div className="gesture-card-desc">
                    <strong>2. İki Parmakla Scroll</strong>
                    <p>İki parmağınızı aynı anda yukarı-aşağı kaydırarak sayfaları ve YouTube listesini pürüzsüz kaydırın.</p>
                  </div>
                </div>

                <div className="gesture-card-row">
                  <div className="gesture-card-anim anim-longpress">
                    <div className="anim-finger-dot" />
                    <div className="anim-radial-ring" />
                  </div>
                  <div className="gesture-card-desc">
                    <strong>3. Uzun Basma / 2 Parmak (Sağ Tık)</strong>
                    <p>Parmağınızı 400ms basılı tutun veya iki parmakla aynı anda dokunun. Sağ tık menüsü açar.</p>
                  </div>
                </div>

                <div className="gesture-card-row">
                  <div className="gesture-card-anim anim-strip">
                    <div className="anim-phone-outline">
                      <div className="anim-strip-thumb" />
                    </div>
                  </div>
                  <div className="gesture-card-desc">
                    <strong>4. Sağ Kenar Başparmak Şeridi</strong>
                    <p>Ekranın en sağındaki şeritten tek başparmağınızla yukarı-aşağı kaydırarak tek elle rahatça scroll yapın.</p>
                  </div>
                </div>

                <div className="gesture-card-row">
                  <div className="gesture-card-anim anim-drag">
                    <div className="anim-window-box" />
                    <div className="anim-drag-cursor" />
                  </div>
                  <div className="gesture-card-desc">
                    <strong>5. Çift Tık & Sürükleme (Pencere Taşı)</strong>
                    <p>Çift dokunup parmağınızı kaldırmadan sürükleyin veya alt bardaki ✋ butonuna basarak pencereleri taşıyın.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Keyboard Modal Sheet */}
      {showKeyboardSheet && (
        <div className="touchpad-sheet-backdrop" onClick={() => setShowKeyboardSheet(false)}>
          <div className="touchpad-sheet touchpad-keyboard-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="touchpad-sheet-handle" />
            <div className="touchpad-sheet-header">
              <div className="touchpad-sheet-title">
                <Keyboard size={18} strokeWidth={2.2} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '6px' }} />
                <span>PC'ye Klavye & Metin Gönder</span>
              </div>
              <button
                type="button"
                className="touchpad-sheet-close"
                onClick={() => setShowKeyboardSheet(false)}
                aria-label="Kapat"
              >
                <X size={18} strokeWidth={2.5} />
              </button>
            </div>

            <div className="touchpad-sheet-content">
              {/* Form with Input and Send Buttons */}
              <form
                className="touchpad-keyboard-modal-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (keyboardText) {
                    sendCommand({ type: 'TYPE_TEXT', text: keyboardText });
                    triggerFeedback(`PC'ye Yazıldı: ${keyboardText.slice(0, 16)}`);
                    setKeyboardText('');
                    keyboardInputRef.current?.focus();
                  }
                }}
              >
                <div className="touchpad-keyboard-input-wrap">
                  <input
                    ref={keyboardInputRef}
                    autoFocus
                    type="text"
                    className="touchpad-keyboard-modal-input"
                    value={keyboardText}
                    onChange={(e) => setKeyboardText(e.target.value)}
                    placeholder="PC'de imlecin olduğu yere yazılacak metin..."
                    autoCapitalize="sentences"
                    autoCorrect="on"
                    spellCheck={true}
                  />
                  {keyboardText && (
                    <button
                      type="button"
                      className="touchpad-keyboard-clear-btn"
                      onClick={() => setKeyboardText('')}
                      aria-label="Temizle"
                    >
                      <X size={14} strokeWidth={2.2} />
                    </button>
                  )}
                </div>

                <div className="touchpad-keyboard-actions-row">
                  <button
                    type="submit"
                    className="touchpad-modal-send-btn"
                    onPointerDown={(e) => e.preventDefault()}
                    disabled={!keyboardText}
                    title="Yazılan Metni PC'ye Gönder"
                  >
                    <Send size={15} strokeWidth={2.2} />
                    <span>PC'ye Gönder</span>
                  </button>

                  <button
                    type="button"
                    className="touchpad-modal-send-enter-btn"
                    disabled={!keyboardText}
                    onClick={() => {
                      if (keyboardText) {
                        sendCommand({ type: 'TYPE_TEXT', text: keyboardText });
                        sendCommand({ type: 'KEY_PRESS', key: 'ENTER' });
                        triggerFeedback('Gönderildi + Enter');
                        setKeyboardText('');
                        setShowKeyboardSheet(false);
                      }
                    }}
                    title="Metni Gönder ve PC'de Enter'a Basıp Kapat"
                  >
                    <CornerDownLeft size={15} strokeWidth={2.2} />
                    <span>Gönder + Enter ↵</span>
                  </button>
                </div>
              </form>

              {/* Hızlı Tuşlar Paneli */}
              <div className="touchpad-sheet-group">
                <div className="touchpad-sheet-label-row">
                  <span>Hızlı PC Tuşları (Doğrudan Gönder)</span>
                </div>
                <div className="touchpad-keyboard-grid-keys">
                  <button
                    type="button"
                    className="touchpad-modal-key"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      sendCommand({ type: 'KEY_PRESS', key: 'ENTER' });
                      triggerFeedback('Enter');
                    }}
                    title="Enter (Seç / Git)"
                  >
                    <CornerDownLeft size={14} strokeWidth={2.2} />
                    <span>Enter ↵</span>
                  </button>

                  <button
                    type="button"
                    className="touchpad-modal-key"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      sendCommand({ type: 'KEY_PRESS', key: 'BACKSPACE' });
                      triggerFeedback('Geri Sil');
                    }}
                    title="Geri Silme (Backspace)"
                  >
                    <Delete size={14} strokeWidth={2.2} />
                    <span>Geri Sil ⌫</span>
                  </button>

                  <button
                    type="button"
                    className="touchpad-modal-key"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      sendCommand({ type: 'KEY_PRESS', key: 'SPACE' });
                      triggerFeedback('Boşluk');
                    }}
                    title="Boşluk Tuşu (Space)"
                  >
                    <span>Boşluk ␣</span>
                  </button>

                  <button
                    type="button"
                    className="touchpad-modal-key"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      sendCommand({ type: 'KEY_PRESS', key: 'TAB' });
                      triggerFeedback('Tab');
                    }}
                    title="Sonraki Kutu (Tab)"
                  >
                    <span>Tab ⇥</span>
                  </button>

                  <button
                    type="button"
                    className="touchpad-modal-key"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      sendCommand({ type: 'KEY_PRESS', key: 'ESCAPE' });
                      triggerFeedback('Esc');
                    }}
                    title="İptal / Çıkış (Esc)"
                  >
                    <span>Esc ⎋</span>
                  </button>

                  <button
                    type="button"
                    className="touchpad-modal-key"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => {
                      sendCommand({ type: 'KEY_PRESS', key: 'DELETE' });
                      triggerFeedback('Del');
                    }}
                    title="İleri Silme (Delete)"
                  >
                    <span>Del ⌦</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
