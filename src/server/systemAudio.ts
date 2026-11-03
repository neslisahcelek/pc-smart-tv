import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { clampInteger } from '../shared/protocol.js';

const POWERSHELL_AUDIO_BRIDGE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out int pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int NotImpl1();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

public class AudioBridge {
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenWindowStation(string lpszWinSta, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetProcessWindowStation(IntPtr hWinSta);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

    private static readonly System.Collections.Concurrent.BlockingCollection<Action> _inputQueue =
        new System.Collections.Concurrent.BlockingCollection<Action>(new System.Collections.Concurrent.ConcurrentQueue<Action>());
    private static Thread _inputThread;
    private static IntPtr _attachedDesktop = IntPtr.Zero;

    static AudioBridge() {
        _inputThread = new Thread(InputWorkerLoop) {
            IsBackground = true,
            Name = "TvInputWorker"
        };
        _inputThread.Start();
    }

    private static void EnsureInteractiveDesktop() {
        if (_attachedDesktop != IntPtr.Zero) return;
        try {
            IntPtr hWinsta = OpenWindowStation("WinSta0", false, 0x037F);
            if (hWinsta != IntPtr.Zero) {
                SetProcessWindowStation(hWinsta);
            }
            IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
            if (hDesk != IntPtr.Zero) {
                if (SetThreadDesktop(hDesk)) {
                    _attachedDesktop = hDesk;
                }
            }
        } catch {}
    }

    private static void InputWorkerLoop() {
        EnsureInteractiveDesktop();
        foreach (var action in _inputQueue.GetConsumingEnumerable()) {
            try {
                if (_attachedDesktop == IntPtr.Zero) {
                    EnsureInteractiveDesktop();
                }
                action();
            } catch {}
        }
    }

    public static void EnqueueInput(Action action) {
        _inputQueue.Add(action);
    }

    public static void Shutdown() {
        try {
            _inputQueue.CompleteAdding();
        } catch {}
    }

    public static void WakeDisplay() {
        EnqueueInput(() => {
            mouse_event(0x0001, 1, 0, 0, UIntPtr.Zero);
            mouse_event(0x0001, -1, 0, 0, UIntPtr.Zero);
        });
    }

    public static void MouseMove(int dx, int dy) {
        EnqueueInput(() => {
            mouse_event(0x0001, dx, dy, 0, UIntPtr.Zero);
        });
    }

    public static void MouseClick(string button) {
        EnqueueInput(() => {
            if (button == "left") {
                mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
                mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
            } else if (button == "right") {
                mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero);
                mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero);
            } else if (button == "middle") {
                mouse_event(0x0020, 0, 0, 0, UIntPtr.Zero);
                mouse_event(0x0040, 0, 0, 0, UIntPtr.Zero);
            } else if (button == "double") {
                mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
                mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
                Thread.Sleep(40);
                mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
                mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
            }
        });
    }

    public static void MouseDown(string button) {
        EnqueueInput(() => {
            if (button == "left") {
                mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
            } else if (button == "right") {
                mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero);
            }
        });
    }

    public static void MouseUp(string button) {
        EnqueueInput(() => {
            if (button == "left") {
                mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
            } else if (button == "right") {
                mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero);
            }
        });
    }

    public static void MouseScroll(int deltaY, int deltaX) {
        EnqueueInput(() => {
            if (deltaY != 0) {
                mouse_event(0x0800, 0, 0, unchecked((uint)deltaY), UIntPtr.Zero);
            }
            if (deltaX != 0) {
                mouse_event(0x1000, 0, 0, unchecked((uint)deltaX), UIntPtr.Zero);
            }
        });
    }

    public static void SendKey(string keyName) {
        EnqueueInput(() => {
            byte vk = 0;
            switch (keyName.ToUpperInvariant()) {
                case "SPACE": vk = 0x20; break;
                case "LEFT": vk = 0x25; break;
                case "UP": vk = 0x26; break;
                case "RIGHT": vk = 0x27; break;
                case "DOWN": vk = 0x28; break;
                case "ENTER": vk = 0x0D; break;
                case "ESCAPE": vk = 0x1B; break;
                case "F": vk = 0x46; break;
                case "M": vk = 0x4D; break;
                case "K": vk = 0x4B; break;
                case "BACKSPACE": vk = 0x08; break;
                case "TAB": vk = 0x09; break;
                case "DELETE": vk = 0x2E; break;
            }
            if (vk != 0) {
                keybd_event(vk, 0, 0, UIntPtr.Zero);
                keybd_event(vk, 0, 2, UIntPtr.Zero);
            }
        });
    }

    [DllImport("user32.dll")]
    private static extern bool OpenClipboard(IntPtr hWndNewOwner);

    [DllImport("user32.dll")]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll")]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll")]
    private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalLock(IntPtr hMem);

    [DllImport("kernel32.dll")]
    private static extern bool GlobalUnlock(IntPtr hMem);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GlobalFree(IntPtr hMem);

    private const uint CF_UNICODETEXT = 13;
    private const uint GMEM_MOVEABLE = 0x0002;

    public static void SendText(string text) {
        if (string.IsNullOrEmpty(text)) return;
        EnqueueInput(() => {
            try {
                bool opened = false;
                for (int i = 0; i < 5; i++) {
                    if (OpenClipboard(IntPtr.Zero)) {
                        opened = true;
                        break;
                    }
                    Thread.Sleep(10);
                }
                if (!opened) return;

                try {
                    EmptyClipboard();
                    byte[] bytes = Encoding.Unicode.GetBytes(text + (char)0);
                    IntPtr hMem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
                    if (hMem != IntPtr.Zero) {
                        IntPtr target = GlobalLock(hMem);
                        if (target != IntPtr.Zero) {
                            Marshal.Copy(bytes, 0, target, bytes.Length);
                            GlobalUnlock(hMem);
                            if (SetClipboardData(CF_UNICODETEXT, hMem) == IntPtr.Zero) {
                                GlobalFree(hMem);
                            }
                        } else {
                            GlobalFree(hMem);
                        }
                    }
                } finally {
                    CloseClipboard();
                }

                // Small pause so Windows clipboard and target app synchronize
                Thread.Sleep(20);

                // Send Ctrl + V
                keybd_event(0x11, 0, 0, UIntPtr.Zero);
                Thread.Sleep(10);
                keybd_event(0x56, 0, 0, UIntPtr.Zero);
                Thread.Sleep(15);
                keybd_event(0x56, 0, 2, UIntPtr.Zero);
                keybd_event(0x11, 0, 2, UIntPtr.Zero);
            } catch {}
        });
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint Msg,
        IntPtr wParam,
        StringBuilder lParam,
        uint fuFlags,
        uint uTimeout,
        out IntPtr lpdwResult
    );

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    private static IAudioEndpointVolume GetVolumeObject() {
        var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice speakers;
        enumerator.GetDefaultAudioEndpoint(0, 1, out speakers);
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        IAudioEndpointVolume vol;
        speakers.Activate(ref iid, 23, 0, out vol);
        return vol;
    }

    public static int GetVolume() {
        float v;
        GetVolumeObject().GetMasterVolumeLevelScalar(out v);
        return (int)Math.Round(v * 100);
    }

    public static void SetVolume(int level) {
        float clamped = Math.Max(0f, Math.Min(100f, (float)level)) / 100f;
        GetVolumeObject().SetMasterVolumeLevelScalar(clamped, Guid.Empty);
    }

    public static bool GetMute() {
        bool m;
        GetVolumeObject().GetMute(out m);
        return m;
    }

    public static void SetMute(bool mute) {
        GetVolumeObject().SetMute(mute, Guid.Empty);
    }

    public static void MediaPlayPause() {
        EnqueueInput(() => {
            keybd_event(0xB3, 0, 0, UIntPtr.Zero);
            keybd_event(0xB3, 0, 2, UIntPtr.Zero);
        });
    }

    private static string GetWindowTitle(IntPtr hWnd) {
        try {
            StringBuilder sb = new StringBuilder(512);
            IntPtr result;
            IntPtr res = SendMessageTimeout(hWnd, 0x000D, (IntPtr)sb.Capacity, sb, 0x0002, 100, out result);
            if (res != IntPtr.Zero) {
                return sb.ToString();
            }
        } catch {}
        return string.Empty;
    }

    private static bool IsTvLauncherWindow(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero || !IsWindowVisible(hWnd)) return false;
        string title = GetWindowTitle(hWnd);
        if (title.IndexOf("Smart TV Launcher", StringComparison.OrdinalIgnoreCase) < 0) return false;

        // Exclude editors, consoles, or IDEs that may have the project name in their window title
        if (title.IndexOf("Visual Studio", StringComparison.OrdinalIgnoreCase) >= 0) return false;
        if (title.IndexOf("VSCodium", StringComparison.OrdinalIgnoreCase) >= 0) return false;
        if (title.IndexOf("Code", StringComparison.OrdinalIgnoreCase) >= 0 && title.IndexOf("Chrome", StringComparison.OrdinalIgnoreCase) < 0) return false;
        if (title.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) >= 0 && title.IndexOf("Chrome", StringComparison.OrdinalIgnoreCase) < 0) return false;

        try {
            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid != 0) {
                var proc = System.Diagnostics.Process.GetProcessById((int)pid);
                string procName = proc.ProcessName.ToLowerInvariant();
                return procName.Contains("chrome") || procName.Contains("msedge") || procName.Contains("brave");
            }
        } catch {}

        return true;
    }

    private static IntPtr FindTvLauncherWindow() {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            if (IsTvLauncherWindow(hWnd)) {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool FocusAndRestore(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return false;
        try {
            ShowWindow(hWnd, 9); // SW_RESTORE (unminimize)
            SetForegroundWindow(hWnd);
            return true;
        } catch {
            return false;
        }
    }

    public static void FocusTvLauncherAsync() {
        ThreadPool.QueueUserWorkItem(_ => {
            try {
                IntPtr tvHwnd = FindTvLauncherWindow();
                if (tvHwnd != IntPtr.Zero) {
                    FocusAndRestore(tvHwnd);
                }
            } catch {}
        });
    }

    private static bool IsAntigravityWindow(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero || !IsWindowVisible(hWnd)) return false;
        string title = GetWindowTitle(hWnd);
        return title.IndexOf("Antigravity", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    public static void FocusAntigravityAsync() {
        ThreadPool.QueueUserWorkItem(_ => {
            try {
                IntPtr found = IntPtr.Zero;
                EnumWindows((hWnd, lParam) => {
                    if (IsAntigravityWindow(hWnd)) {
                        found = hWnd;
                        return false;
                    }
                    return true;
                }, IntPtr.Zero);
                if (found != IntPtr.Zero) {
                    FocusAndRestore(found);
                }
            } catch {}
        });
    }

    private static bool DoHideBookmarksBar() {
        IntPtr tvHwnd = FindTvLauncherWindow();
        if (tvHwnd == IntPtr.Zero) return false;

        IntPtr fg = GetForegroundWindow();
        if (fg != tvHwnd && !IsTvLauncherWindow(fg)) {
            FocusAndRestore(tvHwnd);
            Thread.Sleep(90);
            fg = GetForegroundWindow();
        }

        if (!IsTvLauncherWindow(fg)) {
            return false;
        }

        // Send Ctrl + Shift + B to toggle off Chrome/Edge Bookmarks Bar
        keybd_event(0x11, 0, 0, UIntPtr.Zero);
        keybd_event(0x10, 0, 0, UIntPtr.Zero);
        keybd_event(0x42, 0, 0, UIntPtr.Zero);
        keybd_event(0x42, 0, 2, UIntPtr.Zero);
        keybd_event(0x10, 0, 2, UIntPtr.Zero);
        keybd_event(0x11, 0, 2, UIntPtr.Zero);
        return true;
    }

    public static void HideBookmarksBarAsync() {
        ThreadPool.QueueUserWorkItem(_ => {
            try {
                DoHideBookmarksBar();
            } catch {}
        });
    }
}
'@

try {
    $initVol = [AudioBridge]::GetVolume()
    $initMute = [int][AudioBridge]::GetMute()
    [Console]::Out.WriteLine("STATE $initVol $initMute")
    [Console]::Out.Flush()
} catch {}

while (($line = [Console]::In.ReadLine()) -ne $null) {
    $trimmed = $line.Trim()
    if (-not $trimmed) { continue }
    $parts = $trimmed.Split(' ')
    $cmd = $parts[0]
    try {
        if ($cmd -eq 'VOL' -and $parts.Length -ge 2) {
            [AudioBridge]::SetVolume([int]$parts[1])
        } elseif ($cmd -eq 'MUTE' -and $parts.Length -ge 2) {
            [AudioBridge]::SetMute($parts[1] -eq '1')
        } elseif ($cmd -eq 'PLAYPAUSE') {
            [AudioBridge]::MediaPlayPause()
        } elseif ($cmd -eq 'WAKEDISPLAY') {
            [AudioBridge]::WakeDisplay()
        } elseif ($cmd -eq 'FOCUSTV') {
            [AudioBridge]::FocusTvLauncherAsync()
        } elseif ($cmd -eq 'FOCUSANTIGRAVITY') {
            [AudioBridge]::FocusAntigravityAsync()
        } elseif ($cmd -eq 'HIDEBOOKMARKS') {
            [AudioBridge]::HideBookmarksBarAsync()
        } elseif ($cmd -eq 'MOVE' -and $parts.Length -ge 3) {
            [AudioBridge]::MouseMove([int]$parts[1], [int]$parts[2])
        } elseif ($cmd -eq 'CLICK' -and $parts.Length -ge 2) {
            [AudioBridge]::MouseClick($parts[1])
        } elseif ($cmd -eq 'MOUSEDOWN' -and $parts.Length -ge 2) {
            [AudioBridge]::MouseDown($parts[1])
        } elseif ($cmd -eq 'MOUSEUP' -and $parts.Length -ge 2) {
            [AudioBridge]::MouseUp($parts[1])
        } elseif ($cmd -eq 'SCROLL' -and $parts.Length -ge 2) {
            $dy = [int]$parts[1]
            $dx = if ($parts.Length -ge 3) { [int]$parts[2] } else { 0 }
            [AudioBridge]::MouseScroll($dy, $dx)
        } elseif ($cmd -eq 'KEY' -and $parts.Length -ge 2) {
            [AudioBridge]::SendKey($parts[1])
        } elseif ($cmd -eq 'TEXT' -and $parts.Length -ge 2) {
            $rawText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($parts[1]))
            [AudioBridge]::SendText($rawText)
        } elseif ($cmd -eq 'GET') {
            $v = [AudioBridge]::GetVolume()
            $m = [int][AudioBridge]::GetMute()
            [Console]::Out.WriteLine("STATE $v $m")
            [Console]::Out.Flush()
        } elseif ($cmd -eq 'EXIT') {
            break
        }
    } catch {}
}
`;

function checkChromeBookmarksBarState(): { shown: boolean; mtimeMs: number } {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return { shown: false, mtimeMs: 0 };
  }

  const candidatePaths = [
    path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default', 'Preferences'),
    path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default', 'Preferences')
  ];

  for (const prefPath of candidatePaths) {
    try {
      if (!fs.existsSync(prefPath)) continue;
      const stat = fs.statSync(prefPath);
      const raw = fs.readFileSync(prefPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        bookmark_bar?: {
          show_on_all_tabs?: boolean;
        };
      };
      if (parsed && typeof parsed.bookmark_bar?.show_on_all_tabs === 'boolean') {
        return {
          shown: parsed.bookmark_bar.show_on_all_tabs,
          mtimeMs: stat.mtimeMs
        };
      }
    } catch {
      // ignore locked or unreadable file
    }
  }

  return { shown: false, mtimeMs: 0 };
}

export interface SystemAudioOptions {
  enabled?: boolean;
  onStateSync?: (state: { volume: number; muted: boolean }) => void;
}

/**
 * Controls Windows Master System Volume (0-100%), System Mute, Media Play/Pause key,
 * and automatic hiding of Chrome's Bookmarks Bar when the Smart TV Launcher opens.
 */
export class SystemAudioController {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly enabled: boolean;
  private readonly onStateSync?: (state: { volume: number; muted: boolean }) => void;
  private isClosing = false;
  private bookmarksHiddenConfirmed = false;
  private lastBookmarksHideAt = 0;
  private lastPrefMtimeMs = 0;

  constructor(options?: SystemAudioOptions) {
    this.enabled =
      options?.enabled ??
      (process.platform === 'win32' && process.env.VITEST !== 'true');
    this.onStateSync = options?.onStateSync;

    if (this.enabled) {
      this.startBridgeProcess();
    }
  }

  private startBridgeProcess(): void {
    if (this.isClosing) return;

    try {
      // The script is far larger than the ~32K Windows command-line limit once base64/UTF-16
      // encoded (spawn fails with ENAMETOOLONG), so run it from a temp file instead.
      const scriptPath = path.join(os.tmpdir(), 'smart-tv-launcher-bridge.ps1');
      fs.writeFileSync(scriptPath, `\uFEFF${POWERSHELL_AUDIO_BRIDGE_SCRIPT}`, 'utf8');

      const child = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath
        ],
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      );

      this.child = child;
      child.stderr.resume();

      let stdoutBuffer = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf8');
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('STATE ')) {
            const parts = trimmed.split(' ');
            const vol = Number(parts[1]);
            const mute = parts[2] === '1';
            if (Number.isFinite(vol)) {
              this.onStateSync?.({
                volume: clampInteger(vol, 0, 100),
                muted: mute
              });
            }
          } else if (trimmed === 'BM_HIDDEN 1') {
            this.bookmarksHiddenConfirmed = true;
            this.lastBookmarksHideAt = Date.now();
          }
        }
      });

      child.on('error', () => {
        this.child = null;
      });

      child.on('close', () => {
        this.child = null;
      });
    } catch {
      this.child = null;
    }
  }

  private sendLine(line: string): void {
    if (!this.enabled || this.isClosing) return;
    if (!this.child) {
      this.startBridgeProcess();
    }
    if (this.child && this.child.stdin.writable) {
      try {
        this.child.stdin.write(`${line}\n`);
      } catch {
        // ignore write errors
      }
    }
  }

  public setVolume(volume: number): void {
    const clamped = clampInteger(volume, 0, 100);
    this.sendLine(`VOL ${clamped}`);
  }

  public setMute(muted: boolean): void {
    this.sendLine(`MUTE ${muted ? 1 : 0}`);
  }

  public sendMediaPlayPause(): void {
    this.sendLine('PLAYPAUSE');
  }

  /**
   * High-frequency pointer input is coalesced and flushed on a short timer so the
   * PowerShell bridge (which parses one line at a time) never builds up a backlog.
   */
  private pendingMoveX = 0;
  private pendingMoveY = 0;
  private pendingScrollY = 0;
  private pendingScrollX = 0;
  private pointerFlushTimer: NodeJS.Timeout | null = null;

  private schedulePointerFlush(): void {
    if (this.pointerFlushTimer) return;
    this.pointerFlushTimer = setTimeout(() => {
      this.pointerFlushTimer = null;
      this.flushPointer();
    }, 8);
  }

  private flushPointer(): void {
    if (this.pointerFlushTimer) {
      clearTimeout(this.pointerFlushTimer);
      this.pointerFlushTimer = null;
    }
    const mx = Math.round(this.pendingMoveX);
    const my = Math.round(this.pendingMoveY);
    if (mx !== 0 || my !== 0) {
      this.pendingMoveX -= mx;
      this.pendingMoveY -= my;
      this.sendLine(`MOVE ${mx} ${my}`);
    }
    const sy = Math.round(this.pendingScrollY);
    const sx = Math.round(this.pendingScrollX);
    if (sy !== 0 || sx !== 0) {
      this.pendingScrollY -= sy;
      this.pendingScrollX -= sx;
      this.sendLine(`SCROLL ${sy} ${sx}`);
    }
  }

  public mouseMove(dx: number, dy: number): void {
    if (!this.enabled || this.isClosing) return;
    this.pendingMoveX += dx;
    this.pendingMoveY += dy;
    this.schedulePointerFlush();
  }

  public mouseClick(button: 'left' | 'right' | 'middle' | 'double'): void {
    if (!this.enabled || this.isClosing) return;
    this.flushPointer();
    this.sendLine(`CLICK ${button}`);
  }

  public mouseDown(button: 'left' | 'right'): void {
    if (!this.enabled || this.isClosing) return;
    this.flushPointer();
    this.sendLine(`MOUSEDOWN ${button}`);
  }

  public mouseUp(button: 'left' | 'right'): void {
    if (!this.enabled || this.isClosing) return;
    this.flushPointer();
    this.sendLine(`MOUSEUP ${button}`);
  }

  public mouseScroll(deltaY: number, deltaX = 0): void {
    if (!this.enabled || this.isClosing) return;
    this.pendingScrollY += deltaY;
    this.pendingScrollX += deltaX;
    this.schedulePointerFlush();
  }

  public sendKey(key: string): void {
    if (!this.enabled || this.isClosing) return;
    this.sendLine(`KEY ${key}`);
  }

  public sendText(text: string): void {
    if (!this.enabled || this.isClosing || !text) return;
    const b64 = Buffer.from(text, 'utf8').toString('base64');
    this.sendLine(`TEXT ${b64}`);
  }

  /**
   * Simulates a microscopic mouse jitter to wake the display if Windows
   * turned off the monitors due to display idle timeout.
   */
  public wakeDisplay(): void {
    if (!this.enabled || this.isClosing) return;
    this.sendLine('WAKEDISPLAY');
  }

  /**
   * Brings the Smart TV Launcher browser window to the foreground if it is running.
   */
  public focusTvLauncher(): void {
    if (!this.enabled || this.isClosing) return;
    this.sendLine('FOCUSTV');
  }

  /**
   * Brings Google Antigravity window to the foreground (and restores if minimized).
   */
  public focusAntigravity(): void {
    if (!this.enabled || this.isClosing) return;
    this.sendLine('FOCUSANTIGRAVITY');
  }

  /**
   * Automatically hides Chrome/Edge's Bookmarks Bar (Ctrl+Shift+B) when the Smart TV Launcher
   * (/tv) is open and `bookmark_bar.show_on_all_tabs` is currently enabled in browser preferences.
   */
  public ensureBookmarksBarHidden(): void {
    if (!this.enabled || this.isClosing) return;

    const state = checkChromeBookmarksBarState();
    if (!state.shown) {
      this.bookmarksHiddenConfirmed = false;
      return;
    }

    if (
      this.bookmarksHiddenConfirmed &&
      state.mtimeMs <= this.lastPrefMtimeMs &&
      Date.now() - this.lastBookmarksHideAt < 30000
    ) {
      return;
    }

    this.lastPrefMtimeMs = state.mtimeMs;
    this.sendLine('HIDEBOOKMARKS');
  }

  public close(): void {
    this.isClosing = true;
    if (this.pointerFlushTimer) {
      clearTimeout(this.pointerFlushTimer);
      this.pointerFlushTimer = null;
    }
    if (this.child) {
      try {
        this.child.stdin.write('EXIT\n');
        this.child.kill();
      } catch {
        // ignore
      }
      this.child = null;
    }
  }
}
