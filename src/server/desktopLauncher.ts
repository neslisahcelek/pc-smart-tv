import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn, spawnSync } from 'node:child_process';

export interface DesktopLauncherOptions {
  enabled?: boolean;
  port?: number;
  chromePathOverride?: string;
  antigravityPathOverride?: string;
  launchAntigravity?: boolean;
}

export interface LaunchResult {
  ok: boolean;
  tv: {
    attempted: boolean;
    alreadyConnected: boolean;
    chromePath: string | null;
  };
  antigravity: {
    attempted: boolean;
    alreadyRunning: boolean;
    antigravityPath: string | null;
  };
  message: string;
}

export function findAntigravityPath(override?: string): string | null {
  if (override && fs.existsSync(override)) {
    return override;
  }

  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];

  const candidates: string[] = [];
  if (localAppData) {
    candidates.push(path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'));
  }
  if (programFiles) {
    candidates.push(path.join(programFiles, 'Antigravity', 'Antigravity.exe'));
  }
  if (programFilesX86) {
    candidates.push(path.join(programFilesX86, 'Antigravity', 'Antigravity.exe'));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore access errors
    }
  }

  return null;
}

export function findChromePath(override?: string): string | null {
  if (override && fs.existsSync(override)) {
    return override;
  }

  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;

  const candidates: string[] = [];
  if (programFiles) {
    candidates.push(path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (programFilesX86) {
    candidates.push(path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (localAppData) {
    candidates.push(path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore access errors
    }
  }

  return process.platform === 'win32' ? 'chrome' : null;
}

export function isAntigravityRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || process.env.VITEST === 'true') {
      resolve(false);
      return;
    }

    exec('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH', { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) {
        resolve(false);
        return;
      }
      resolve(stdout.toLowerCase().includes('antigravity.exe'));
    });
  });
}

export const TV_SCHEDULED_TASK_NAME = 'SmartTvLauncher-OpenTv';

export function registerTvScheduledTask(chromePath: string, port = 3000): void {
  if (process.platform !== 'win32' || process.env.VITEST === 'true') return;
  try {
    const url = `http://localhost:${port}/tv`;
    const escapedChrome = chromePath.replace(/'/g, "''");
    const script = `& { $action = New-ScheduledTaskAction -Execute '${escapedChrome}' -Argument '--app=${url} --start-fullscreen --autoplay-policy=no-user-gesture-required'; Register-ScheduledTask -TaskName '${TV_SCHEDULED_TASK_NAME}' -Action $action -Force }`;
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: 'ignore'
    }).unref();
  } catch {
    // ignore registration errors
  }
}

export class DesktopLauncher {
  private readonly enabled: boolean;
  private readonly defaultPort: number;
  private readonly chromePathOverride?: string;
  private readonly antigravityPathOverride?: string;
  private readonly defaultLaunchAntigravity: boolean;

  private lastTvLaunchAt = 0;
  private lastAntigravityLaunchAt = 0;
  private readonly cooldownMs = 3000; // 3 seconds cooldown between rapid taps

  constructor(options?: DesktopLauncherOptions) {
    this.enabled =
      options?.enabled ??
      (process.platform === 'win32' && process.env.VITEST !== 'true');
    this.defaultPort = options?.port ?? 3000;
    this.chromePathOverride = options?.chromePathOverride;
    this.antigravityPathOverride = options?.antigravityPathOverride;
    this.defaultLaunchAntigravity =
      options?.launchAntigravity ??
      (process.env.LAUNCH_ANTIGRAVITY?.toLowerCase() === 'true' ||
       process.env.LAUNCH_ANTIGRAVITY === '1');

    if (this.enabled) {
      const chrome = findChromePath(this.chromePathOverride);
      if (chrome) {
        registerTvScheduledTask(chrome, this.defaultPort);
      }
    }
  }

  public async launchAntigravity(force = false): Promise<{ attempted: boolean; alreadyRunning: boolean; path: string | null }> {
    const antigravityPath = findAntigravityPath(this.antigravityPathOverride);

    if (!this.enabled) {
      return { attempted: false, alreadyRunning: false, path: antigravityPath };
    }

    const now = Date.now();
    if (!force && now - this.lastAntigravityLaunchAt < this.cooldownMs) {
      return { attempted: false, alreadyRunning: true, path: antigravityPath };
    }

    const running = await isAntigravityRunning();
    if (!antigravityPath) {
      return { attempted: false, alreadyRunning: running, path: null };
    }

    if (running && !force) {
      return { attempted: false, alreadyRunning: true, path: antigravityPath };
    }

    try {
      this.lastAntigravityLaunchAt = now;
      const child = spawn(antigravityPath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      return { attempted: true, alreadyRunning: running, path: antigravityPath };
    } catch (err) {
      console.error('[DesktopLauncher] Antigravity başlatılamadı:', err);
      return { attempted: false, alreadyRunning: running, path: antigravityPath };
    }
  }

  public launchTvChrome(
    port?: number,
    force = false,
    alreadyConnected = false
  ): { attempted: boolean; chromePath: string | null } {
    const chromePath = findChromePath(this.chromePathOverride);

    if (!this.enabled || (alreadyConnected && !force)) {
      return { attempted: false, chromePath };
    }

    const now = Date.now();
    if (!force && now - this.lastTvLaunchAt < this.cooldownMs) {
      return { attempted: false, chromePath };
    }

    if (!chromePath) {
      return { attempted: false, chromePath: null };
    }

    const targetPort = port ?? this.defaultPort;
    const url = `http://localhost:${targetPort}/tv`;
    const args = [
      `--app=${url}`,
      '--start-fullscreen',
      '--autoplay-policy=no-user-gesture-required'
    ];

    try {
      this.lastTvLaunchAt = now;
      let launchedViaSchtasks = false;

      // On Windows, schtasks runs in the user's interactive session (WinSta0\Default),
      // seamlessly reusing the user's running Chrome profile without single-instance collisions.
      if (process.platform === 'win32' && process.env.VITEST !== 'true') {
        const runRes = spawnSync('schtasks', ['/run', '/tn', TV_SCHEDULED_TASK_NAME], {
          windowsHide: true,
          encoding: 'utf8'
        });
        if (runRes.status === 0) {
          launchedViaSchtasks = true;
        } else {
          registerTvScheduledTask(chromePath, targetPort);
        }
      }

      if (!launchedViaSchtasks) {
        const child = spawn(chromePath, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        child.unref();
      }

      return { attempted: true, chromePath };
    } catch (err) {
      console.error('[DesktopLauncher] Chrome TV başlatılamadı:', err);
      return { attempted: false, chromePath };
    }
  }

  /**
   * Ensures the TV interface (and optionally Antigravity if explicitly requested) is open and visible on the Windows host.
   */
  public async ensureDesktopApps(options?: {
    port?: number;
    tvConnectedCount?: number;
    forceTv?: boolean;
    forceAntigravity?: boolean;
    includeAntigravity?: boolean;
  }): Promise<LaunchResult> {
    const tvConnected = (options?.tvConnectedCount ?? 0) > 0;
    const targetPort = options?.port ?? this.defaultPort;

    const tvResult = this.launchTvChrome(
      targetPort,
      options?.forceTv,
      tvConnected
    );

    const shouldLaunchAntigravity =
      options?.forceAntigravity === true ||
      options?.includeAntigravity === true ||
      (options?.forceAntigravity === undefined && this.defaultLaunchAntigravity);

    let antigravityResult: { attempted: boolean; alreadyRunning: boolean; path: string | null } = {
      attempted: false,
      alreadyRunning: false,
      path: null
    };

    if (shouldLaunchAntigravity) {
      antigravityResult = await this.launchAntigravity(options?.forceAntigravity);
    }

    const messages: string[] = [];
    if (tvResult.attempted) {
      messages.push('TV arayüzü Chrome ile açıldı/öne getirildi');
    } else if (tvConnected) {
      messages.push('TV arayüzü zaten açık');
    }

    if (antigravityResult.attempted) {
      messages.push(
        antigravityResult.alreadyRunning
          ? 'Antigravity öne getirildi'
          : 'Antigravity başlatıldı'
      );
    } else if (antigravityResult.alreadyRunning && shouldLaunchAntigravity) {
      messages.push('Antigravity zaten çalışıyor');
    }

    return {
      ok: true,
      tv: {
        attempted: tvResult.attempted,
        alreadyConnected: tvConnected,
        chromePath: tvResult.chromePath
      },
      antigravity: {
        attempted: antigravityResult.attempted,
        alreadyRunning: antigravityResult.alreadyRunning,
        antigravityPath: antigravityResult.path
      },
      message: messages.join('; ') || 'İşlem tamamlandı.'
    };
  }
}
