import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, type RunningServer } from '../server/index.js';
import type { ServerBroadcastMessage } from '../shared/types.js';

function waitForMessage(
  ws: WebSocket,
  predicate: (msg: ServerBroadcastMessage) => boolean,
  timeoutMs = 4000
): Promise<ServerBroadcastMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    function onMsg(raw: Buffer | string) {
      const parsed = JSON.parse(raw.toString()) as ServerBroadcastMessage;
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off('message', onMsg);
        resolve(parsed);
      }
    }

    ws.on('message', onMsg);
  });
}

describe('Remote-to-TV WebSocket Vertical Slice & Integration', () => {
  let server: RunningServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('synchronizes state and routes PLAY_VIDEO, SET_VOLUME, and NAVIGATE from Remote to TV', async () => {
    server = await createServer(
      {
        port: 0,
        host: '127.0.0.1',
        allowLan: false,
        youtubeApiKey: null
      },
      { isProduction: true }
    );

    const baseWsUrl = `ws://127.0.0.1:${server.port}/ws`;

    const tvClient = new WebSocket(`${baseWsUrl}?role=tv`);
    const tvInitialSync = await waitForMessage(
      tvClient,
      (m) => m.type === 'STATE_SYNC' && m.state.tvConnectedCount === 1
    );
    expect(tvInitialSync.type).toBe('STATE_SYNC');
    if (tvInitialSync.type === 'STATE_SYNC') {
      expect(tvInitialSync.state.sections?.some((s) => s.id === 'watch_later')).toBe(true);
    }

    const remoteClient = new WebSocket(`${baseWsUrl}?role=remote`);
    const remoteInitialSync = await waitForMessage(
      remoteClient,
      (m) =>
        m.type === 'STATE_SYNC' &&
        m.state.tvConnectedCount === 1 &&
        m.state.remoteConnectedCount === 1
    );
    expect(remoteInitialSync.type).toBe('STATE_SYNC');

    // 1. Remote sends PLAY_VIDEO -> TV receives TV_COMMAND and STATE_SYNC updates activeView to 'player'
    const tvCommandPromise = waitForMessage(
      tvClient,
      (m) => m.type === 'TV_COMMAND' && m.command.type === 'PLAY_VIDEO'
    );
    const stateAfterPlayPromise = waitForMessage(
      remoteClient,
      (m) => m.type === 'STATE_SYNC' && m.state.nowPlaying?.videoId === 'dQw4w9WgXcQ'
    );

    remoteClient.send(
      JSON.stringify({
        type: 'PLAY_VIDEO',
        videoId: 'dQw4w9WgXcQ',
        title: 'Test Song',
        channelTitle: 'Test Channel'
      })
    );

    const [tvCommand, stateAfterPlay] = await Promise.all([
      tvCommandPromise,
      stateAfterPlayPromise
    ]);

    expect(tvCommand.type).toBe('TV_COMMAND');
    if (stateAfterPlay.type === 'STATE_SYNC') {
      expect(stateAfterPlay.state.activeView).toBe('player');
      expect(stateAfterPlay.state.nowPlaying?.title).toBe('Test Song');
    }

    // 2. Remote adjusts volume -> TV receives volume update
    const stateAfterVolPromise = waitForMessage(
      remoteClient,
      (m) => m.type === 'STATE_SYNC' && m.state.volume === 55
    );
    remoteClient.send(JSON.stringify({ type: 'SET_VOLUME', volume: 55 }));
    const stateAfterVol = await stateAfterVolPromise;
    if (stateAfterVol.type === 'STATE_SYNC') {
      expect(stateAfterVol.state.volume).toBe(55);
    }

    // 3. Invalid command is rejected with ERROR
    const errorMsgPromise = waitForMessage(remoteClient, (m) => m.type === 'ERROR');
    remoteClient.send(JSON.stringify({ type: 'UNKNOWN_CMD' }));
    const errorMsg = await errorMsgPromise;
    expect(errorMsg.type).toBe('ERROR');

    // 4. Hiding, reordering, deleting, and resetting shortcuts & sections sync across TV and Remote
    const hidePromise = waitForMessage(
      tvClient,
      (m) =>
        m.type === 'STATE_SYNC' &&
        Boolean(m.state.shortcuts.find((s) => s.id === 'appletv')?.hidden)
    );
    tvClient.send(
      JSON.stringify({
        type: 'TOGGLE_SHORTCUT_HIDDEN',
        shortcutId: 'appletv',
        hidden: true
      })
    );
    const hideSync = await hidePromise;
    expect(hideSync.type).toBe('STATE_SYNC');

    // Reorder netflix before youtube
    const reorderPromise = waitForMessage(
      tvClient,
      (m) =>
        m.type === 'STATE_SYNC' &&
        m.state.shortcuts.filter((s) => s.category === 'platform' && !s.hidden)[0]?.id === 'netflix'
    );
    tvClient.send(
      JSON.stringify({
        type: 'REORDER_SHORTCUT',
        shortcutId: 'netflix',
        direction: 'PREV'
      })
    );
    await reorderPromise;

    // Delete gain shortcut
    const deletePromise = waitForMessage(
      tvClient,
      (m) => m.type === 'STATE_SYNC' && !m.state.shortcuts.some((s) => s.id === 'gain')
    );
    tvClient.send(
      JSON.stringify({
        type: 'DELETE_SHORTCUT',
        shortcutId: 'gain'
      })
    );
    await deletePromise;

    // Reset layout restores gain and un-hides appletv
    const resetPromise = waitForMessage(
      tvClient,
      (m) =>
        m.type === 'STATE_SYNC' &&
        m.state.shortcuts.some((s) => s.id === 'gain') &&
        m.state.shortcuts.find((s) => s.id === 'appletv')?.hidden === false
    );
    tvClient.send(JSON.stringify({ type: 'RESET_LAYOUT' }));
    await resetPromise;

    // 5. One-step HTTP Share endpoint (/api/youtube/play) immediately opens video in a new YouTube tab on TV
    const shareTvCmdPromise = waitForMessage(
      tvClient,
      (m) =>
        m.type === 'TV_COMMAND' &&
        m.command.type === 'OPEN_YOUTUBE_EXTERNAL' &&
        m.command.target === 'video' &&
        m.command.queryOrVideoId === 'jNQXAC9IVRw'
    );
    const shareRes = await fetch(
      `http://127.0.0.1:${server.port}/api/youtube/play?url=${encodeURIComponent(
        'Me at the zoo https://youtu.be/jNQXAC9IVRw?si=abc'
      )}`
    );
    expect(shareRes.status).toBe(200);
    const shareJson = (await shareRes.json()) as { ok: boolean; videoId: string };
    expect(shareJson.ok).toBe(true);
    expect(shareJson.videoId).toBe('jNQXAC9IVRw');

    const shareTvCmd = await shareTvCmdPromise;
    expect(shareTvCmd.type).toBe('TV_COMMAND');
    expect(server.wsHub.getState().activeView).toBe('home');

    // 6. Remote sends SAVE_PROGRESS -> updates server state, broadcasts STATE_SYNC with new progress item
    const progressSyncPromise = waitForMessage(
      tvClient,
      (m) =>
        m.type === 'STATE_SYNC' &&
        Boolean(m.state.progress?.some((p) => p.key === 'seinfeld' && p.episode === 5))
    );
    remoteClient.send(
      JSON.stringify({
        type: 'SAVE_PROGRESS',
        url: 'https://dizigom1.co/seinfeld-3-sezon-5-bolum-hd1/',
        title: 'Seinfeld 3. Sezon 5. Bölüm'
      })
    );
    const progressSync = await progressSyncPromise;
    expect(progressSync.type).toBe('STATE_SYNC');

    // 7. Remote sends ADVANCE_PROGRESS -> increments episode to 6 and broadcasts
    const advanceSyncPromise = waitForMessage(
      remoteClient,
      (m) =>
        m.type === 'STATE_SYNC' &&
        Boolean(m.state.progress?.some((p) => p.key === 'seinfeld' && p.episode === 6))
    );
    remoteClient.send(
      JSON.stringify({
        type: 'ADVANCE_PROGRESS',
        key: 'seinfeld'
      })
    );
    const advanceSync = await advanceSyncPromise;
    expect(advanceSync.type).toBe('STATE_SYNC');

    // 8. Remote sends REMOVE_WATCH_LATER -> updates state and broadcasts to TV
    const removeSyncPromise = waitForMessage(
      tvClient,
      (m) =>
        m.type === 'STATE_SYNC' &&
        Boolean(m.state.deletedWatchLaterVideoIds?.includes('dQw4w9WgXcQ'))
    );
    remoteClient.send(
      JSON.stringify({
        type: 'REMOVE_WATCH_LATER',
        videoId: 'dQw4w9WgXcQ'
      })
    );
    const removeSync = await removeSyncPromise;
    expect(removeSync.type).toBe('STATE_SYNC');
    expect(server.wsHub.getDeletedWatchLaterVideoIds()).toContain('dQw4w9WgXcQ');

    // 9. Remote sends RESTORE_WATCH_LATER -> restores video in state and broadcasts
    const restoreSyncPromise = waitForMessage(
      remoteClient,
      (m) =>
        m.type === 'STATE_SYNC' &&
        !m.state.deletedWatchLaterVideoIds?.includes('dQw4w9WgXcQ')
    );
    remoteClient.send(
      JSON.stringify({
        type: 'RESTORE_WATCH_LATER',
        videoId: 'dQw4w9WgXcQ'
      })
    );
    const restoreSync = await restoreSyncPromise;
    expect(restoreSync.type).toBe('STATE_SYNC');
    expect(server.wsHub.getDeletedWatchLaterVideoIds()).not.toContain('dQw4w9WgXcQ');

    // 10. HTTP REST endpoints for playlist removal and restoration
    const httpRemoveRes = await fetch(`http://127.0.0.1:${server.port}/api/youtube/playlist/remove`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: 'dQw4w9WgXcQ' })
    });
    expect(httpRemoveRes.status).toBe(200);
    const httpRemoveData = (await httpRemoveRes.json()) as { ok: boolean; deletedVideoIds: string[] };
    expect(httpRemoveData.ok).toBe(true);
    expect(httpRemoveData.deletedVideoIds).toContain('dQw4w9WgXcQ');

    const httpRestoreRes = await fetch(`http://127.0.0.1:${server.port}/api/youtube/playlist/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: 'dQw4w9WgXcQ' })
    });
    expect(httpRestoreRes.status).toBe(200);
    const httpRestoreData = (await httpRestoreRes.json()) as { ok: boolean; deletedVideoIds: string[] };
    expect(httpRestoreData.ok).toBe(true);
    expect(httpRestoreData.deletedVideoIds).not.toContain('dQw4w9WgXcQ');

    tvClient.close();
    remoteClient.close();
  });

  it('processes MOUSE_MOVE, MOUSE_CLICK, MOUSE_SCROLL, and KEY_PRESS without crashing', async () => {
    server = await createServer(
      {
        port: 0,
        host: '127.0.0.1',
        allowLan: false,
        youtubeApiKey: null
      },
      { isProduction: true }
    );

    const baseWsUrl = `ws://127.0.0.1:${server.port}/ws`;
    const remoteClient = new WebSocket(`${baseWsUrl}?role=remote`);

    await waitForMessage(remoteClient, (m) => m.type === 'STATE_SYNC');

    // Send MOUSE_MOVE
    remoteClient.send(JSON.stringify({ type: 'MOUSE_MOVE', dx: 15, dy: -20 }));

    // Send MOUSE_SCROLL
    remoteClient.send(JSON.stringify({ type: 'MOUSE_SCROLL', deltaY: 120 }));

    // Send MOUSE_CLICK
    remoteClient.send(JSON.stringify({ type: 'MOUSE_CLICK', button: 'left' }));

    // Send KEY_PRESS
    remoteClient.send(JSON.stringify({ type: 'KEY_PRESS', key: 'SPACE' }));

    // Verify ping/pong still works and server remains fully operational
    const pongPromise = waitForMessage(remoteClient, (m) => m.type === 'PONG');
    remoteClient.send(JSON.stringify({ type: 'PING', timestamp: 12345 }));
    const pong = await pongPromise;
    expect(pong.type).toBe('PONG');
    if (pong.type === 'PONG') {
      expect(pong.timestamp).toBe(12345);
    }

    remoteClient.close();
  });

  it('rejects cross-site WebSocket connections with unauthorized Origin header', async () => {
    server = await createServer(
      {
        port: 0,
        host: '127.0.0.1',
        allowLan: false,
        youtubeApiKey: null
      },
      { isProduction: true }
    );

    const baseWsUrl = `ws://127.0.0.1:${server.port}/ws`;

    // 1. Connection with malicious cross-site origin must be rejected with 403
    await new Promise<void>((resolve) => {
      const maliciousClient = new WebSocket(`${baseWsUrl}?role=remote`, {
        headers: {
          Origin: 'https://evil-attacker.com'
        }
      });

      maliciousClient.on('error', (err: any) => {
        expect(err.message).toMatch(/403/);
        resolve();
      });

      maliciousClient.on('open', () => {
        maliciousClient.close();
        throw new Error('Malicious cross-site origin should have been rejected');
      });
    });

    // 2. Connection with trusted localhost origin must succeed
    const trustedClient = new WebSocket(`${baseWsUrl}?role=remote`, {
      headers: {
        Origin: 'http://localhost:3000'
      }
    });

    const initialSync = await waitForMessage(trustedClient, (m) => m.type === 'STATE_SYNC');
    expect(initialSync.type).toBe('STATE_SYNC');
    trustedClient.close();
  });
});
