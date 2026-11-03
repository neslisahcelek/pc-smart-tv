import { describe, expect, it } from 'vitest';
import { isPrivateLanIp } from '../server/config.js';
import {
  buildSafeYouTubeExternalUrl,
  extractYouTubeVideoId,
  validateClientMessage
} from '../shared/protocol.js';
import { isSafeHttpsUrl, parseCustomShortcuts } from '../shared/shortcuts.js';

describe('Protocol & Security Boundary Validation', () => {
  const allowedIds = new Set(['youtube', 'netflix', 'hbomax', 'yabancidizi']);

  it('extracts valid 11-char YouTube video IDs from direct IDs and various URL formats', () => {
    expect(extractYouTubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s')).toBe(
      'dQw4w9WgXcQ'
    );
    expect(extractYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=123')).toBe('dQw4w9WgXcQ');
    expect(extractYouTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ'
    );
    expect(extractYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ'
    );
    expect(
      extractYouTubeVideoId('Bu videoya göz atın: https://youtu.be/dQw4w9WgXcQ?si=share123')
    ).toBe('dQw4w9WgXcQ');

    // Rejects invalid or non-YouTube URLs
    expect(extractYouTubeVideoId('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(extractYouTubeVideoId('javascript:alert(1)')).toBeNull();
    expect(extractYouTubeVideoId('short')).toBeNull();
  });

  it('validates allowed COMMAND and NAVIGATE messages and rejects unknown actions', () => {
    const validCmd = validateClientMessage(JSON.stringify({ type: 'COMMAND', action: 'PLAY' }));
    expect(validCmd.ok).toBe(true);
    expect(validCmd.message).toEqual({ type: 'COMMAND', action: 'PLAY' });

    const invalidCmd = validateClientMessage(
      JSON.stringify({ type: 'COMMAND', action: 'EXEC_SHELL' })
    );
    expect(invalidCmd.ok).toBe(false);

    const validNav = validateClientMessage(
      JSON.stringify({ type: 'NAVIGATE', direction: 'RIGHT' })
    );
    expect(validNav.ok).toBe(true);

    const invalidNav = validateClientMessage(
      JSON.stringify({ type: 'NAVIGATE', direction: 'DIAGONAL' })
    );
    expect(invalidNav.ok).toBe(false);
  });

  it('clamps SET_VOLUME to 0..100 and ADJUST_VOLUME to -100..100', () => {
    const highVol = validateClientMessage({ type: 'SET_VOLUME', volume: 250 });
    expect(highVol.ok).toBe(true);
    if (highVol.message?.type === 'SET_VOLUME') {
      expect(highVol.message.volume).toBe(100);
    }

    const lowVol = validateClientMessage({ type: 'SET_VOLUME', volume: -35 });
    expect(lowVol.ok).toBe(true);
    if (lowVol.message?.type === 'SET_VOLUME') {
      expect(lowVol.message.volume).toBe(0);
    }

    const zeroDelta = validateClientMessage({ type: 'ADJUST_VOLUME', delta: 0 });
    expect(zeroDelta.ok).toBe(false);
  });

  it('enforces shortcut allowlist on OPEN_SHORTCUT and blocks arbitrary URLs', () => {
    const allowed = validateClientMessage(
      { type: 'OPEN_SHORTCUT', shortcutId: 'netflix' },
      allowedIds
    );
    expect(allowed.ok).toBe(true);

    const blocked = validateClientMessage(
      { type: 'OPEN_SHORTCUT', shortcutId: 'unregistered_site' },
      allowedIds
    );
    expect(blocked.ok).toBe(false);

    const urlInjection = validateClientMessage(
      { type: 'OPEN_SHORTCUT', shortcutId: 'https://malicious.example' },
      allowedIds
    );
    expect(urlInjection.ok).toBe(false);
  });

  it('validates PLAY_VIDEO and sanitizes control characters from titles', () => {
    const playMsg = validateClientMessage({
      type: 'PLAY_VIDEO',
      videoId: 'https://youtu.be/dQw4w9WgXcQ',
      title: 'Test\u0000Video',
      channelTitle: 'TestChannel'
    });
    expect(playMsg.ok).toBe(true);
    if (playMsg.message?.type === 'PLAY_VIDEO') {
      expect(playMsg.message.videoId).toBe('dQw4w9WgXcQ');
      expect(playMsg.message.title).toBe('TestVideo');
    }
  });

  it('validates safe https URLs and custom shortcuts', () => {
    expect(isSafeHttpsUrl('https://www.netflix.com')).toBe(true);
    expect(isSafeHttpsUrl('http://www.netflix.com')).toBe(false);
    expect(isSafeHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpsUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);

    const custom = parseCustomShortcuts(
      JSON.stringify([
        { id: 'blutv', name: 'BluTV', url: 'https://www.blutv.com' },
        { id: 'bad', name: 'Bad', url: 'javascript:evil()' }
      ])
    );
    expect(custom).toHaveLength(1);
    expect(custom[0].id).toBe('blutv');
  });

  it('constructs safe external YouTube fallback URLs', () => {
    expect(buildSafeYouTubeExternalUrl('video', 'dQw4w9WgXcQ')).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    expect(buildSafeYouTubeExternalUrl('search', 'seinfeld bloopers')).toBe(
      'https://www.youtube.com/results?search_query=seinfeld%20bloopers'
    );
  });

  it('validates shortcut and section customization messages (hide, delete, reorder, add, reset)', () => {
    const reorderOk = validateClientMessage(
      { type: 'REORDER_SHORTCUT', shortcutId: 'netflix', direction: 'PREV' },
      allowedIds
    );
    expect(reorderOk.ok).toBe(true);

    const reorderMissingDir = validateClientMessage(
      { type: 'REORDER_SHORTCUT', shortcutId: 'netflix' },
      allowedIds
    );
    expect(reorderMissingDir.ok).toBe(false);

    const hideOk = validateClientMessage(
      { type: 'TOGGLE_SHORTCUT_HIDDEN', shortcutId: 'hbomax', hidden: true },
      allowedIds
    );
    expect(hideOk.ok).toBe(true);

    const deleteOk = validateClientMessage(
      { type: 'DELETE_SHORTCUT', shortcutId: 'yabancidizi' },
      allowedIds
    );
    expect(deleteOk.ok).toBe(true);

    const addSafe = validateClientMessage({
      type: 'ADD_SHORTCUT',
      name: 'Disney+',
      url: 'https://www.disneyplus.com',
      category: 'platform'
    });
    expect(addSafe.ok).toBe(true);

    const addUnsafe = validateClientMessage({
      type: 'ADD_SHORTCUT',
      name: 'Unsafe',
      url: 'javascript:alert(1)',
      category: 'platform'
    });
    expect(addUnsafe.ok).toBe(false);

    const secReorder = validateClientMessage({
      type: 'REORDER_SECTION',
      sectionId: 'dizi_site',
      direction: 'UP'
    });
    expect(secReorder.ok).toBe(true);

    const secHide = validateClientMessage({
      type: 'TOGGLE_SECTION_HIDDEN',
      sectionId: 'bookmark',
      hidden: true
    });
    expect(secHide.ok).toBe(true);

    const resetOk = validateClientMessage({ type: 'RESET_LAYOUT' });
    expect(resetOk.ok).toBe(true);

    const launchDefault = validateClientMessage({ type: 'LAUNCH_DESKTOP' });
    expect(launchDefault.ok).toBe(true);
    expect(launchDefault.message).toEqual({ type: 'LAUNCH_DESKTOP', target: 'tv' });

    const launchAll = validateClientMessage({ type: 'LAUNCH_DESKTOP', target: 'all' });
    expect(launchAll.ok).toBe(true);
    expect(launchAll.message).toEqual({ type: 'LAUNCH_DESKTOP', target: 'all' });

    const launchTv = validateClientMessage({ type: 'LAUNCH_DESKTOP', target: 'tv' });
    expect(launchTv.ok).toBe(true);
    expect(launchTv.message).toEqual({ type: 'LAUNCH_DESKTOP', target: 'tv' });

    const launchAntigravity = validateClientMessage({ type: 'LAUNCH_DESKTOP', target: 'antigravity' });
    expect(launchAntigravity.ok).toBe(true);
    expect(launchAntigravity.message).toEqual({ type: 'LAUNCH_DESKTOP', target: 'antigravity' });

    // REMOVE_WATCH_LATER
    const removeOk = validateClientMessage({
      type: 'REMOVE_WATCH_LATER',
      videoId: 'dQw4w9WgXcQ'
    });
    expect(removeOk.ok).toBe(true);
    expect(removeOk.message).toEqual({
      type: 'REMOVE_WATCH_LATER',
      videoId: 'dQw4w9WgXcQ'
    });

    const removeInvalid = validateClientMessage({
      type: 'REMOVE_WATCH_LATER',
      videoId: 'invalid-id'
    });
    expect(removeInvalid.ok).toBe(false);

    // RESTORE_WATCH_LATER
    const restoreOk = validateClientMessage({
      type: 'RESTORE_WATCH_LATER',
      videoId: 'dQw4w9WgXcQ'
    });
    expect(restoreOk.ok).toBe(true);
    expect(restoreOk.message).toEqual({
      type: 'RESTORE_WATCH_LATER',
      videoId: 'dQw4w9WgXcQ'
    });

    const restoreInvalid = validateClientMessage({
      type: 'RESTORE_WATCH_LATER',
      videoId: 'too-long-id-12345678'
    });
    expect(restoreInvalid.ok).toBe(false);

    // CLEAR_REMOVED_WATCH_LATER
    const clearOk = validateClientMessage({
      type: 'CLEAR_REMOVED_WATCH_LATER'
    });
    expect(clearOk.ok).toBe(true);
    expect(clearOk.message).toEqual({
      type: 'CLEAR_REMOVED_WATCH_LATER'
    });
  });

  it('validates and clamps MOUSE_MOVE, MOUSE_CLICK, MOUSE_DOWN, MOUSE_UP, and MOUSE_SCROLL', () => {
    // MOUSE_MOVE
    const validMove = validateClientMessage({
      type: 'MOUSE_MOVE',
      dx: 12.4,
      dy: -8.7
    });
    expect(validMove.ok).toBe(true);
    expect(validMove.message).toEqual({
      type: 'MOUSE_MOVE',
      dx: 12,
      dy: -9
    });

    const clampedMove = validateClientMessage({
      type: 'MOUSE_MOVE',
      dx: 9999,
      dy: -9999
    });
    expect(clampedMove.ok).toBe(true);
    expect(clampedMove.message).toEqual({
      type: 'MOUSE_MOVE',
      dx: 500,
      dy: -500
    });

    const invalidMove = validateClientMessage({
      type: 'MOUSE_MOVE',
      dx: NaN,
      dy: 10
    });
    expect(invalidMove.ok).toBe(false);

    // MOUSE_CLICK
    for (const btn of ['left', 'right', 'middle', 'double'] as const) {
      const clickOk = validateClientMessage({ type: 'MOUSE_CLICK', button: btn });
      expect(clickOk.ok).toBe(true);
      expect(clickOk.message).toEqual({ type: 'MOUSE_CLICK', button: btn });
    }
    const invalidClick = validateClientMessage({ type: 'MOUSE_CLICK', button: 'invalid_btn' });
    expect(invalidClick.ok).toBe(false);

    // MOUSE_DOWN & MOUSE_UP
    const downOk = validateClientMessage({ type: 'MOUSE_DOWN', button: 'left' });
    expect(downOk.ok).toBe(true);
    const upOk = validateClientMessage({ type: 'MOUSE_UP', button: 'right' });
    expect(upOk.ok).toBe(true);
    const invalidDown = validateClientMessage({ type: 'MOUSE_DOWN', button: 'middle' });
    expect(invalidDown.ok).toBe(false);

    // MOUSE_SCROLL
    const scrollOk = validateClientMessage({
      type: 'MOUSE_SCROLL',
      deltaY: 120,
      deltaX: -60
    });
    expect(scrollOk.ok).toBe(true);
    expect(scrollOk.message).toEqual({
      type: 'MOUSE_SCROLL',
      deltaY: 120,
      deltaX: -60
    });

    const clampedScroll = validateClientMessage({
      type: 'MOUSE_SCROLL',
      deltaY: 99999
    });
    expect(clampedScroll.ok).toBe(true);
    expect(clampedScroll.message).toEqual({
      type: 'MOUSE_SCROLL',
      deltaY: 2000
    });

    const invalidScroll = validateClientMessage({
      type: 'MOUSE_SCROLL',
      deltaY: Infinity
    });
    expect(invalidScroll.ok).toBe(false);
  });

  it('validates KEY_PRESS messages and allows only whitelisted media/playback keys', () => {
    const validKeys = [
      'SPACE',
      'LEFT',
      'RIGHT',
      'UP',
      'DOWN',
      'F',
      'M',
      'ESCAPE',
      'ENTER',
      'K',
      'BACKSPACE',
      'TAB',
      'DELETE'
    ] as const;
    for (const k of validKeys) {
      const res = validateClientMessage({ type: 'KEY_PRESS', key: k });
      expect(res.ok).toBe(true);
      expect(res.message).toEqual({ type: 'KEY_PRESS', key: k });
    }

    const invalidKey = validateClientMessage({ type: 'KEY_PRESS', key: 'ALT_F4' });
    expect(invalidKey.ok).toBe(false);
  });

  it('validates TYPE_TEXT messages correctly', () => {
    const valid = validateClientMessage({ type: 'TYPE_TEXT', text: 'Merhaba Dünya! Türkçe test: çğışöü' });
    expect(valid.ok).toBe(true);
    expect(valid.message).toEqual({
      type: 'TYPE_TEXT',
      text: 'Merhaba Dünya! Türkçe test: çğışöü'
    });

    const empty = validateClientMessage({ type: 'TYPE_TEXT', text: '' });
    expect(empty.ok).toBe(false);

    const nonString = validateClientMessage({ type: 'TYPE_TEXT', text: 12345 });
    expect(nonString.ok).toBe(false);

    const oversized = validateClientMessage({ type: 'TYPE_TEXT', text: 'a'.repeat(501) });
    expect(oversized.ok).toBe(false);

    const withNulls = validateClientMessage({ type: 'TYPE_TEXT', text: 'Hello\0World' });
    expect(withNulls.ok).toBe(true);
    expect(withNulls.message).toEqual({ type: 'TYPE_TEXT', text: 'HelloWorld' });

    const onlyNulls = validateClientMessage({ type: 'TYPE_TEXT', text: '\0\0\0' });
    expect(onlyNulls.ok).toBe(false);
  });

  it('validates private LAN IP addresses including IPv4, IPv6, and local hostnames', () => {
    // Localhost & loopbacks
    expect(isPrivateLanIp('127.0.0.1')).toBe(true);
    expect(isPrivateLanIp('::1')).toBe(true);
    expect(isPrivateLanIp('localhost')).toBe(true);
    expect(isPrivateLanIp('::ffff:127.0.0.1')).toBe(true);

    // Private IPv4 ranges
    expect(isPrivateLanIp('192.168.1.10')).toBe(true);
    expect(isPrivateLanIp('10.0.0.5')).toBe(true);
    expect(isPrivateLanIp('172.16.0.1')).toBe(true);
    expect(isPrivateLanIp('172.31.255.255')).toBe(true);

    // IPv6 link-local and ULA
    expect(isPrivateLanIp('fe80::1ff:fe23:4567:890a')).toBe(true);
    expect(isPrivateLanIp('fe80::1%eth0')).toBe(true);
    expect(isPrivateLanIp('fc00::1')).toBe(true);
    expect(isPrivateLanIp('fd12:3456:789a:1::1')).toBe(true);

    // mDNS local domain
    expect(isPrivateLanIp('my-pc.local')).toBe(true);

    // Public IPs (must be rejected)
    expect(isPrivateLanIp('8.8.8.8')).toBe(false);
    expect(isPrivateLanIp('1.1.1.1')).toBe(false);
    expect(isPrivateLanIp('172.32.0.1')).toBe(false);
    expect(isPrivateLanIp('evil.com')).toBe(false);
  });
});
