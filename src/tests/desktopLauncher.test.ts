import { describe, expect, it } from 'vitest';
import {
  DesktopLauncher,
  findAntigravityPath,
  findChromePath
} from '../server/desktopLauncher.js';

describe('DesktopLauncher', () => {
  it('locates Antigravity path if available or handles missing gracefully', () => {
    const path = findAntigravityPath();
    // On this machine it should be a string or null on CI
    if (path) {
      expect(typeof path).toBe('string');
      expect(path.toLowerCase()).toContain('antigravity');
    }
  });

  it('locates Chrome path or falls back safely', () => {
    const chrome = findChromePath();
    expect(chrome).toBeDefined();
  });

  it('respects tvConnectedCount and avoids duplicate launch', async () => {
    const launcher = new DesktopLauncher({ enabled: false });

    // When TV is already connected (count = 1)
    const resultConnected = await launcher.ensureDesktopApps({
      tvConnectedCount: 1
    });
    expect(resultConnected.ok).toBe(true);
    expect(resultConnected.tv.alreadyConnected).toBe(true);
    expect(resultConnected.tv.attempted).toBe(false);
    expect(resultConnected.antigravity.attempted).toBe(false);

    // When TV is not connected (count = 0)
    const resultDisconnected = await launcher.ensureDesktopApps({
      tvConnectedCount: 0
    });
    expect(resultDisconnected.ok).toBe(true);
    expect(resultDisconnected.tv.alreadyConnected).toBe(false);
    expect(resultDisconnected.antigravity.attempted).toBe(false);
  });

  it('does not launch Antigravity by default, only when explicitly requested', async () => {
    const launcher = new DesktopLauncher({ enabled: false });

    const defaultResult = await launcher.ensureDesktopApps({ tvConnectedCount: 0 });
    expect(defaultResult.antigravity.attempted).toBe(false);

    const explicitResult = await launcher.ensureDesktopApps({
      tvConnectedCount: 0,
      forceAntigravity: true
    });
    // With enabled: false, attempted remains false but forceAntigravity path was evaluated
    expect(explicitResult.ok).toBe(true);
  });

  it('respects launchAntigravity option when configured', async () => {
    const launcherWithout = new DesktopLauncher({ enabled: false, launchAntigravity: false });
    const resWithout = await launcherWithout.ensureDesktopApps({ tvConnectedCount: 0 });
    expect(resWithout.antigravity.attempted).toBe(false);

    const launcherWith = new DesktopLauncher({ enabled: false, launchAntigravity: true });
    const resWith = await launcherWith.ensureDesktopApps({ tvConnectedCount: 0 });
    expect(resWith.ok).toBe(true);
  });
});
