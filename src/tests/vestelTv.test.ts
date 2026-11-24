import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VESTEL_KEY_CODE_MAP,
  VestelTvController,
  isSafeLocalTvHost
} from '../server/vestelTv.js';

describe('VestelTvController', () => {
  const controllers: VestelTvController[] = [];
  const tempFiles: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    while (controllers.length > 0) {
      controllers.pop()?.close();
    }
    while (tempFiles.length > 0) {
      const f = tempFiles.pop();
      if (f && fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    }
  });

  it('strictly allows only RFC1918 LAN IPs and .local hostnames (SSRF defense)', () => {
    expect(isSafeLocalTvHost('192.168.1.50')).toBe(true);
    expect(isSafeLocalTvHost('10.0.0.15')).toBe(true);
    expect(isSafeLocalTvHost('172.16.4.20')).toBe(true);
    expect(isSafeLocalTvHost('vestel-tv.local')).toBe(true);

    expect(isSafeLocalTvHost('8.8.8.8')).toBe(false);
    expect(isSafeLocalTvHost('169.254.169.254')).toBe(false);
    expect(isSafeLocalTvHost('127.0.0.1')).toBe(false);
    expect(isSafeLocalTvHost('localhost')).toBe(false);
    expect(isSafeLocalTvHost('http://192.168.1.50')).toBe(false);
    expect(isSafeLocalTvHost('192.168.1.999')).toBe(false);
  });

  it('sends XML key commands and falls back across vr_remote -> smartcenter -> raw_tcp', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? '') });
      if (url.endsWith('/apps/vr/remote')) {
        return new Response('Not Found', { status: 404 });
      }
      if (url.endsWith('/apps/SmartCenter')) {
        return new Response('', { status: 200 });
      }
      return new Response('', { status: 500 });
    };

    const ctrl = new VestelTvController({
      initialHost: '192.168.1.88',
      fetchImpl: fakeFetch,
      delayImpl: async () => {}
    });
    controllers.push(ctrl);

    const ok = await ctrl.sendKey('OK');
    expect(ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('http://192.168.1.88:56789/apps/vr/remote');
    expect(calls[1].url).toBe('http://192.168.1.88:56789/apps/SmartCenter');
    expect(calls[1].body).toContain(`code="${VESTEL_KEY_CODE_MAP.OK}"`);
    expect(ctrl.getStatus().detectedVariant).toBe('smartcenter');
    expect(ctrl.getStatus().connected).toBe(true);

    // Subsequent key uses cached detectedVariant first
    await ctrl.sendKey('CH_UP');
    expect(calls).toHaveLength(3);
    expect(calls[2].url).toBe('http://192.168.1.88:56789/apps/SmartCenter');
    expect(calls[2].body).toContain(`code="${VESTEL_KEY_CODE_MAP.CH_UP}"`);
  });

  it('uses raw_tcp only when explicitly configured', async () => {
    const tcpSent: Array<{ host: string; code: number }> = [];
    const ctrl = new VestelTvController({
      initialHost: '192.168.1.90',
      fetchImpl: async () => new Response('', { status: 500 }),
      tcpSenderImpl: async (host, code) => {
        tcpSent.push({ host, code });
        return true;
      },
      delayImpl: async () => {}
    });
    controllers.push(ctrl);

    // Auto mode must NOT send raw TCP to port 4660
    expect(await ctrl.sendKey('SOURCE')).toBe(false);
    expect(tcpSent).toEqual([]);

    ctrl.setConfig({ protocolVariant: 'raw_tcp' });
    const ok = await ctrl.sendKey('SOURCE');
    expect(ok).toBe(true);
    expect(tcpSent).toEqual([{ host: '192.168.1.90', code: VESTEL_KEY_CODE_MAP.SOURCE }]);
    expect(ctrl.getStatus().detectedVariant).toBe('raw_tcp');
  });

  it('dismisses sleep prompt safely with EXIT by default or RIGHT + OK when requested', async () => {
    const sentCodes: number[] = [];
    const ctrl = new VestelTvController({
      initialHost: '192.168.1.55',
      fetchImpl: async (_url, init) => {
        const match = String(init?.body ?? '').match(/code="(\d+)"/);
        if (match) sentCodes.push(Number(match[1]));
        return new Response('', { status: 200 });
      },
      delayImpl: async () => {}
    });
    controllers.push(ctrl);

    expect(await ctrl.dismissSleepPrompt()).toBe(true);
    expect(sentCodes).toEqual([VESTEL_KEY_CODE_MAP.EXIT]);

    sentCodes.length = 0;
    expect(await ctrl.dismissSleepPrompt('right_ok')).toBe(true);
    expect(sentCodes).toEqual([VESTEL_KEY_CODE_MAP.RIGHT, VESTEL_KEY_CODE_MAP.OK]);
  });

  it('tunes multi-digit TV channels by sending digit keys followed by OK', async () => {
    const sentCodes: number[] = [];
    const ctrl = new VestelTvController({
      initialHost: '192.168.1.55',
      fetchImpl: async (_url, init) => {
        const match = String(init?.body ?? '').match(/code="(\d+)"/);
        if (match) sentCodes.push(Number(match[1]));
        return new Response('', { status: 200 });
      },
      delayImpl: async () => {}
    });
    controllers.push(ctrl);

    expect(await ctrl.tuneChannel(24)).toBe(true);
    expect(sentCodes).toEqual([
      VESTEL_KEY_CODE_MAP.NUM_2,
      VESTEL_KEY_CODE_MAP.NUM_4,
      VESTEL_KEY_CODE_MAP.OK
    ]);
  });

  it('persists configuration and favorite channels to disk and reloads them', () => {
    const tmpFile = path.join(
      os.tmpdir(),
      `vestel-tv-test-${process.pid}-${Date.now()}.json`
    );
    tempFiles.push(tmpFile);

    const ctrl1 = new VestelTvController({ configFilePath: tmpFile });
    controllers.push(ctrl1);

    const res = ctrl1.setConfig({
      host: '192.168.1.77',
      protocolVariant: 'smartcenter',
      keepAwakeEnabled: true,
      keepAwakeIntervalMinutes: 30
    });
    expect(res.ok).toBe(true);

    ctrl1.saveFavoriteChannel({ id: 'trt1', name: 'TRT 1', channelNumber: 1 });
    ctrl1.saveFavoriteChannel({ id: 'ntv', name: 'NTV', channelNumber: 24 });
    ctrl1.deleteFavoriteChannel('ntv');

    const ctrl2 = new VestelTvController({ configFilePath: tmpFile });
    controllers.push(ctrl2);
    const st = ctrl2.getStatus();
    expect(st.configuredHost).toBe('192.168.1.77');
    expect(st.protocolVariant).toBe('smartcenter');
    expect(st.keepAwakeEnabled).toBe(true);
    expect(st.keepAwakeIntervalMinutes).toBe(30);
    expect(st.favoriteChannels).toEqual([{ id: 'trt1', name: 'TRT 1', channelNumber: 1 }]);
  });

  it('fires Keep-Awake INFO + EXIT pulse on schedule and stops when closed', async () => {
    vi.useFakeTimers();
    const sentCodes: number[] = [];
    const ctrl = new VestelTvController({
      initialHost: '192.168.1.60',
      fetchImpl: async (_url, init) => {
        const match = String(init?.body ?? '').match(/code="(\d+)"/);
        if (match) sentCodes.push(Number(match[1]));
        return new Response('', { status: 200 });
      },
      delayImpl: async () => {}
    });
    controllers.push(ctrl);

    ctrl.setConfig({ keepAwakeEnabled: true, keepAwakeIntervalMinutes: 10 });
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 50);

    expect(sentCodes).toEqual([VESTEL_KEY_CODE_MAP.INFO, VESTEL_KEY_CODE_MAP.EXIT]);
    expect(ctrl.getStatus().lastKeepAwakeAt).not.toBeNull();

    ctrl.close();
    sentCodes.length = 0;
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(sentCodes).toEqual([]);
  });

  it('controls TV volume via UPnP RenderingControl when available', async () => {
    let currentTvVol = 32;
    const soapActions: string[] = [];
    const ctrl = new VestelTvController({
      initialHost: '192.168.1.70',
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url === 'http://192.168.1.70:2870/dmr.xml') {
          return new Response(
            `<root><device><serviceList><service>
              <serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType>
              <controlURL>/upnp/control/RenderingControl</controlURL>
            </service></serviceList></device></root>`,
            { status: 200 }
          );
        }
        if (url === 'http://192.168.1.70:2870/upnp/control/RenderingControl') {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          const soapAction = headers.SOAPACTION ?? '';
          soapActions.push(soapAction);
          if (soapAction.includes('GetVolume')) {
            return new Response(`<CurrentVolume>${currentTvVol}</CurrentVolume>`, { status: 200 });
          }
          if (soapAction.includes('SetVolume')) {
            const match = String(init?.body ?? '').match(/<DesiredVolume>(\d+)<\/DesiredVolume>/);
            if (match) currentTvVol = Number(match[1]);
            return new Response('<u:SetVolumeResponse/>', { status: 200 });
          }
        }
        return new Response('', { status: 404 });
      },
      delayImpl: async () => {}
    });
    controllers.push(ctrl);

    expect(await ctrl.syncVolume()).toBe(true);
    expect(ctrl.getStatus().volume).toBe(32);
    expect(ctrl.getStatus().volumeSynced).toBe(true);

    expect(await ctrl.setVolume(45)).toBe(true);
    expect(currentTvVol).toBe(45);
    expect(ctrl.getStatus().volume).toBe(45);
    expect(soapActions.some((a) => a.includes('#SetVolume'))).toBe(true);
  });

  it('falls back to VOL_UP/VOL_DOWN steps when UPnP RenderingControl is unavailable', async () => {
    const sentCodes: number[] = [];
    const ctrl = new VestelTvController({
      initialHost: '192.168.1.71',
      fetchImpl: async (input, init) => {
        const url = String(input);
        if (url.endsWith('/apps/vr/remote')) {
          const match = String(init?.body ?? '').match(/code="(\d+)"/);
          if (match) sentCodes.push(Number(match[1]));
          return new Response('', { status: 200 });
        }
        return new Response('', { status: 404 });
      },
      delayImpl: async () => {}
    });
    controllers.push(ctrl);

    // Default tracked volume starts at 20 -> setting 24 sends 4 VOL_UP keys
    expect(await ctrl.setVolume(24)).toBe(true);
    expect(sentCodes).toEqual([
      VESTEL_KEY_CODE_MAP.VOL_UP,
      VESTEL_KEY_CODE_MAP.VOL_UP,
      VESTEL_KEY_CODE_MAP.VOL_UP,
      VESTEL_KEY_CODE_MAP.VOL_UP
    ]);
    expect(ctrl.getStatus().volume).toBe(24);
    expect(ctrl.getStatus().volumeSynced).toBe(false);
  });
});
