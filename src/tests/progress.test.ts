import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  advanceProgressEpisode,
  buildNextEpisode,
  deleteProgress,
  loadProgress,
  progressEntryToShortcut,
  upsertProgress
} from '../server/progress.js';
import {
  extractSeasonAndEpisode,
  extractSeriesKey,
  formatCleanSeriesAndEpisode,
  getColorForHost
} from '../server/bookmarks.js';
import { createServer, type RunningServer } from '../server/index.js';

describe('Progress Engine Unit Tests', () => {
  let tempFilePath: string;

  beforeEach(() => {
    tempFilePath = path.join(
      os.tmpdir(),
      `test-progress-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`
    );
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch {
      // ignore
    }
  });

  it('correctly extracts series keys and season/episode numbers from various sites and patterns', () => {
    // 1. Dizigom format
    const key1 = extractSeriesKey(
      'Seinfeld 3. Sezon 3. Bölüm izle',
      'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/'
    );
    expect(key1).toBe('seinfeld');

    const se1 = extractSeasonAndEpisode(
      'Seinfeld 3. Sezon 3. Bölüm izle',
      'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/'
    );
    expect(se1).toEqual({ season: 3, episode: 3 });

    // 2. Selcukflix format
    const key2 = extractSeriesKey(
      'The Marvelous Mrs. Maisel 4. Sezon 1. Bölüm',
      'https://selcukflix.com/dizi/the-marvelous-mrs-maisel/sezon-4/bolum-1'
    );
    expect(key2).toBe('themarvelousmrsmaisel');

    const se2 = extractSeasonAndEpisode(
      '',
      'https://selcukflix.com/dizi/the-marvelous-mrs-maisel/sezon-4/bolum-1'
    );
    expect(se2).toEqual({ season: 4, episode: 1 });

    // 3. Dizipal compact SxY format
    const key3 = extractSeriesKey(
      'The White Lotus 2x2 izle',
      'https://dizipal906.com/bolum/the-white-lotus-2x2'
    );
    expect(key3).toBe('thewhitelotus');

    const se3 = extractSeasonAndEpisode('The White Lotus', 'https://dizipal906.com/bolum/the-white-lotus-2x2');
    expect(se3).toEqual({ season: 2, episode: 2 });

    // 4. Clean formatting
    const formatted = formatCleanSeriesAndEpisode(
      key1,
      'Seinfeld 3. Sezon 3. Bölüm Türkçe Dublaj 1080p Full HD izle Dizigom',
      'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/'
    );
    expect(formatted.seriesTitle).toBe('Seinfeld');
    expect(formatted.episodeLabel).toBe('3. Sezon • 3. Bölüm');

    // 5. Apple TV format
    const keyApple = extractSeriesKey(
      'Biscuits - Ted Lasso (Season 1, Episode 2) - Apple TV+',
      'https://tv.apple.com/us/episode/biscuits/umc.cmc.2435'
    );
    expect(keyApple).toBe('tedlasso');

    const seApple = extractSeasonAndEpisode(
      'Biscuits - Ted Lasso (Season 1, Episode 2) - Apple TV+',
      'https://tv.apple.com/us/episode/biscuits/umc.cmc.2435'
    );
    expect(seApple).toEqual({ season: 1, episode: 2 });

    const formattedApple = formatCleanSeriesAndEpisode(
      keyApple,
      'Biscuits - Ted Lasso (Season 1, Episode 2) - Apple TV+',
      'https://tv.apple.com/us/episode/biscuits/umc.cmc.2435'
    );
    expect(formattedApple.seriesTitle).toBe('Ted Lasso');
    expect(formattedApple.episodeLabel).toBe('1. Sezon • 2. Bölüm');

    // 6. Turkish localized Apple TV format
    const keyAppleTr = extractSeriesKey(
      'Severance (1. Sezon, 1. Bölüm) - Apple TV',
      'https://tv.apple.com/tr/episode/pilot/umc.cmc.1488ez4dp942etebq3p85k1np'
    );
    expect(keyAppleTr).toBe('severance');

    const formattedAppleTr = formatCleanSeriesAndEpisode(
      keyAppleTr,
      'Severance (1. Sezon, 1. Bölüm) - Apple TV',
      'https://tv.apple.com/tr/episode/pilot/umc.cmc.1488ez4dp942etebq3p85k1np'
    );
    expect(formattedAppleTr.seriesTitle).toBe('Severance');
    expect(formattedAppleTr.episodeLabel).toBe('1. Sezon • 1. Bölüm');

    // 7. Max (HBO Max) format
    const keyMax = extractSeriesKey(
      "Watch Succession - Season 4, Episode 3: Connor's Wedding | Max",
      'https://play.max.com/video/watch/12345'
    );
    expect(keyMax).toBe('succession');

    const seMax = extractSeasonAndEpisode(
      "Watch Succession - Season 4, Episode 3: Connor's Wedding | Max",
      'https://play.max.com/video/watch/12345'
    );
    expect(seMax).toEqual({ season: 4, episode: 3 });

    const formattedMax = formatCleanSeriesAndEpisode(
      keyMax,
      "Watch Succession - Season 4, Episode 3: Connor's Wedding | Max",
      'https://play.max.com/video/watch/12345'
    );
    expect(formattedMax.seriesTitle).toBe('Succession');
    expect(formattedMax.episodeLabel).toBe('4. Sezon • 3. Bölüm');

    // 8. Max S1 E4 format
    const keyPenguin = extractSeriesKey(
      "Watch The Penguin - Season 1 Episode 4: Cent'Anni | Max",
      'https://play.max.com/episode/urn:hbo:episode:98765'
    );
    expect(keyPenguin).toBe('thepenguin');

    const formattedPenguin = formatCleanSeriesAndEpisode(
      keyPenguin,
      "Watch The Penguin - Season 1 Episode 4: Cent'Anni | Max",
      'https://play.max.com/episode/urn:hbo:episode:98765'
    );
    expect(formattedPenguin.seriesTitle).toBe('The Penguin');
    expect(formattedPenguin.episodeLabel).toBe('1. Sezon • 4. Bölüm');

    // 9. Host colors for Apple TV & Max
    expect(getColorForHost('tv.apple.com')).toBe('#475569');
    expect(getColorForHost('play.max.com')).toBe('#4f46e5');
    expect(getColorForHost('play.hbomax.com')).toBe('#4f46e5');
  });

  it('upserts progress, enforces single entry per series key, and updates latest episode', () => {
    // Insert episode 3
    const entry1 = upsertProgress(
      {
        url: 'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/',
        title: 'Seinfeld 3. Sezon 3. Bölüm'
      },
      tempFilePath
    );
    expect(entry1.key).toBe('seinfeld');
    expect(entry1.season).toBe(3);
    expect(entry1.episode).toBe(3);

    let list = loadProgress(tempFilePath);
    expect(list).toHaveLength(1);
    expect(list[0].episode).toBe(3);

    // Upsert episode 4 for the same series -> must replace entry1, not duplicate
    const entry2 = upsertProgress(
      {
        url: 'https://dizigom1.co/seinfeld-3-sezon-4-bolum-hd1/',
        title: 'Seinfeld 3. Sezon 4. Bölüm'
      },
      tempFilePath
    );
    expect(entry2.key).toBe('seinfeld');
    expect(entry2.episode).toBe(4);

    list = loadProgress(tempFilePath);
    expect(list).toHaveLength(1);
    expect(list[0].episode).toBe(4);
    expect(list[0].episodeLabel).toBe('3. Sezon • 4. Bölüm');

    // Add another series
    upsertProgress(
      {
        url: 'https://dizilla.now/death-note-1-sezon-29-bolum',
        title: 'Death Note 1. Sezon 29. Bölüm'
      },
      tempFilePath
    );
    list = loadProgress(tempFilePath);
    expect(list).toHaveLength(2);
    expect(list[0].key).toBe('deathnote'); // Most recent at top
  });

  it('buildNextEpisode properly increments episode numbers and updates URL patterns', () => {
    const next1 = buildNextEpisode({
      key: 'seinfeld',
      title: 'Seinfeld',
      season: 3,
      episode: 3,
      episodeLabel: '3. Sezon • 3. Bölüm',
      url: 'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/',
      host: 'dizigom1.co',
      updatedAt: Date.now()
    });
    expect(next1.episode).toBe(4);
    expect(next1.episodeLabel).toBe('3. Sezon • 4. Bölüm');
    expect(next1.url).toBe('https://dizigom1.co/seinfeld-3-sezon-4-bolum-hd1/');

    const next2 = buildNextEpisode({
      key: 'themarvelousmrsmaisel',
      title: 'The Marvelous Mrs. Maisel',
      season: 4,
      episode: 1,
      episodeLabel: '4. Sezon • 1. Bölüm',
      url: 'https://selcukflix.com/dizi/the-marvelous-mrs-maisel/sezon-4/bolum-1',
      host: 'selcukflix.com',
      updatedAt: Date.now()
    });
    expect(next2.episode).toBe(2);
    expect(next2.episodeLabel).toBe('4. Sezon • 2. Bölüm');
    expect(next2.url).toBe('https://selcukflix.com/dizi/the-marvelous-mrs-maisel/sezon-4/bolum-2');

    const next3 = buildNextEpisode({
      key: 'thewhitelotus',
      title: 'The White Lotus',
      season: 2,
      episode: 2,
      episodeLabel: '2. Sezon • 2. Bölüm',
      url: 'https://dizipal906.com/bolum/the-white-lotus-2x2',
      host: 'dizipal906.com',
      updatedAt: Date.now()
    });
    expect(next3.episode).toBe(3);
    expect(next3.episodeLabel).toBe('2. Sezon • 3. Bölüm');
    expect(next3.url).toBe('https://dizipal906.com/bolum/the-white-lotus-2x3');
  });

  it('advanceProgressEpisode advances stored entry in progress.json', () => {
    upsertProgress(
      {
        url: 'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/',
        title: 'Seinfeld 3. Sezon 3. Bölüm'
      },
      tempFilePath
    );

    const advanced = advanceProgressEpisode('seinfeld', tempFilePath);
    expect(advanced).not.toBeNull();
    expect(advanced?.episode).toBe(4);
    expect(advanced?.episodeLabel).toBe('3. Sezon • 4. Bölüm');
    expect(advanced?.url).toBe('https://dizigom1.co/seinfeld-3-sezon-4-bolum-hd1/');

    const list = loadProgress(tempFilePath);
    expect(list[0].episode).toBe(4);
  });

  it('deletes progress entry and converts entry to shortcut item correctly', () => {
    const entry = upsertProgress(
      {
        url: 'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/',
        title: 'Seinfeld 3. Sezon 3. Bölüm'
      },
      tempFilePath
    );

    const sc = progressEntryToShortcut(entry);
    expect(sc.id).toBe('bm-series-seinfeld');
    expect(sc.category).toBe('bookmark');
    expect(sc.name).toBe('Seinfeld');
    expect(sc.subtitle).toBe('3. Sezon • 3. Bölüm');

    const deleted = deleteProgress('seinfeld', tempFilePath);
    expect(deleted).toBe(true);
    expect(loadProgress(tempFilePath)).toHaveLength(0);
  });
});

describe('HTTP /api/progress API Integration', () => {
  let server: RunningServer | null = null;
  let tempFilePath: string;

  beforeEach(async () => {
    tempFilePath = path.join(
      os.tmpdir(),
      `test-http-progress-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`
    );

    server = await createServer(
      {
        port: 0,
        host: '127.0.0.1',
        allowLan: false,
        youtubeApiKey: null,
        progressFilePath: tempFilePath,
        progressToken: 'secret123'
      },
      { isProduction: true }
    );
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch {
      // ignore
    }
  });

  it('rejects unauthenticated requests when progressToken is configured', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.port}/api/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://dizigom1.co/test-1-sezon-1-bolum' })
    });
    expect(res.status).toBe(401);
  });

  it('accepts authenticated POST /api/progress and returns the saved entry', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.port}/api/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Progress-Token': 'secret123'
      },
      body: JSON.stringify({
        url: 'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/',
        title: 'Seinfeld 3. Sezon 3. Bölüm'
      })
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; entry: { key: string; episode: number } };
    expect(data.ok).toBe(true);
    expect(data.entry.key).toBe('seinfeld');
    expect(data.entry.episode).toBe(3);

    // GET /api/progress
    const getRes = await fetch(`http://127.0.0.1:${server!.port}/api/progress`, {
      headers: { 'X-Progress-Token': 'secret123' }
    });
    const getData = (await getRes.json()) as { ok: boolean; entries: Array<{ key: string }> };
    expect(getData.ok).toBe(true);
    expect(getData.entries.some((e) => e.key === 'seinfeld')).toBe(true);

    // Advance episode (+1)
    const advRes = await fetch(
      `http://127.0.0.1:${server!.port}/api/progress/seinfeld/advance`,
      {
        method: 'POST',
        headers: { 'X-Progress-Token': 'secret123' }
      }
    );
    expect(advRes.status).toBe(200);
    const advData = (await advRes.json()) as { ok: boolean; entry: { episode: number } };
    expect(advData.entry.episode).toBe(4);

    // DELETE /api/progress/:key
    const delRes = await fetch(`http://127.0.0.1:${server!.port}/api/progress/seinfeld`, {
      method: 'DELETE',
      headers: { 'X-Progress-Token': 'secret123' }
    });
    expect(delRes.status).toBe(200);
    const delData = (await delRes.json()) as { ok: boolean; deleted: boolean };
    expect(delData.deleted).toBe(true);
  });
});
