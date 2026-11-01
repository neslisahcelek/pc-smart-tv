import type { ShortcutItem, TVSectionConfig } from './types.js';
import { PLATFORM_ICON_DATA_URLS } from './platformIcons.js';

export const DEFAULT_TV_SECTIONS: TVSectionConfig[] = [
  {
    id: 'watch_later',
    title: 'Daha Sonra İzle',
    hint: 'YouTube',
    hidden: false
  },
  {
    id: 'bookmark',
    title: 'İzlemeye Devam Et',
    hint: '',
    hidden: false
  },
  {
    id: 'platform',
    title: 'Platformlar',
    hint: '',
    hidden: false
  },
  {
    id: 'dizi_site',
    title: 'Dizi & Film Siteleri',
    hint: '',
    hidden: false
  }
];

export const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  // Ana Yayın Platformları (Streaming Platforms)
  {
    id: 'youtube',
    name: 'YouTube',
    subtitle: '',
    url: 'https://www.youtube.com',
    category: 'platform',
    color: '#e11d48',
    badge: '▶',
    imageUrl: PLATFORM_ICON_DATA_URLS.youtube
  },
  {
    id: 'netflix',
    name: 'Netflix',
    subtitle: '',
    url: 'https://www.netflix.com/browse',
    category: 'platform',
    color: '#dc2626',
    badge: 'N',
    imageUrl: PLATFORM_ICON_DATA_URLS.netflix
  },
  {
    id: 'hbomax',
    name: 'Max',
    subtitle: '',
    url: 'https://www.max.com',
    category: 'platform',
    color: '#4f46e5',
    badge: 'MAX',
    imageUrl: PLATFORM_ICON_DATA_URLS.hbomax
  },
  {
    id: 'appletv',
    name: 'Apple TV+',
    subtitle: '',
    url: 'https://tv.apple.com',
    category: 'platform',
    color: '#475569',
    badge: 'tv',
    imageUrl: PLATFORM_ICON_DATA_URLS.appletv
  },
  {
    id: 'primevideo',
    name: 'Prime Video',
    subtitle: '',
    url: 'https://www.primevideo.com',
    category: 'platform',
    color: '#0284c7',
    badge: 'PV',
    imageUrl: PLATFORM_ICON_DATA_URLS.primevideo
  },
  {
    id: 'gain',
    name: 'GAİN',
    subtitle: '',
    url: 'https://www.gain.tv',
    category: 'platform',
    color: '#be123c',
    badge: 'G',
    imageUrl: PLATFORM_ICON_DATA_URLS.gain
  },

  // Dizi Siteleri (Chrome "dizi" Klasöründeki Ana Siteler)
  {
    id: 'yabancidizi',
    name: 'YabancıDizi',
    subtitle: '',
    url: 'https://yabancidizi.io',
    category: 'dizi_site',
    color: '#d97706',
    badge: 'YD',
    imageUrl: PLATFORM_ICON_DATA_URLS.yabancidizi
  },
  {
    id: 'dizibox',
    name: 'DiziBOX',
    subtitle: '',
    url: 'https://www.dizibox.live',
    category: 'dizi_site',
    color: '#059669',
    badge: 'DBX',
    imageUrl: PLATFORM_ICON_DATA_URLS.dizibox
  },
  {
    id: 'dizilla',
    name: 'Dizilla',
    subtitle: '',
    url: 'https://dizilla.now',
    category: 'dizi_site',
    color: '#7c3aed',
    badge: 'DZL',
    imageUrl: PLATFORM_ICON_DATA_URLS.dizilla
  },
  {
    id: 'hdfilmcehennemi',
    name: 'HDFilmCehennemi',
    subtitle: '',
    url: 'https://www.hdfilmcehennemi.nl',
    category: 'dizi_site',
    color: '#ea580c',
    badge: 'HDF',
    imageUrl: PLATFORM_ICON_DATA_URLS.hdfilmcehennemi
  },
  {
    id: 'dizigom',
    name: 'Dizigom',
    subtitle: '',
    url: 'https://dizigom1.co',
    category: 'dizi_site',
    color: '#0891b2',
    badge: 'DZG',
    imageUrl: PLATFORM_ICON_DATA_URLS.dizigom
  },
  {
    id: 'filmmakinesi',
    name: 'FilmMakinesi',
    subtitle: '',
    url: 'https://filmmakinesi.to',
    category: 'dizi_site',
    color: '#db2777',
    badge: 'FM',
    imageUrl: PLATFORM_ICON_DATA_URLS.filmmakinesi
  },
  {
    id: 'selcukflix',
    name: 'SelçukFlix',
    subtitle: '',
    url: 'https://selcukflix.com',
    category: 'dizi_site',
    color: '#0d9488',
    badge: 'SFX',
    imageUrl: PLATFORM_ICON_DATA_URLS.selcukflix
  },
  {
    id: 'dizipal',
    name: 'Dizipal',
    subtitle: '',
    url: 'https://dizipal906.com',
    category: 'dizi_site',
    color: '#4f46e5',
    badge: 'DZP',
    imageUrl: PLATFORM_ICON_DATA_URLS.dizipal
  }
];

export const SERIES_ARTWORK_BY_KEY: Record<
  string,
  {
    cleanTitle: string;
    imageUrl: string;
  }
> = {
  seinfeld: {
    cleanTitle: 'Seinfeld',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/219/549578.jpg'
  },
  themarvelousmrsmaisel: {
    cleanTitle: 'The Marvelous Mrs. Maisel',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/215/539234.jpg'
  },
  theoffice: {
    cleanTitle: 'The Office',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/220/550710.jpg'
  },
  thewhitelotus: {
    cleanTitle: 'The White Lotus',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/334/835010.jpg'
  },
  friends: {
    cleanTitle: 'Friends',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/219/548045.jpg'
  },
  vikingler: {
    cleanTitle: 'Vikings',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/93/233095.jpg'
  },
  vikings: {
    cleanTitle: 'Vikings',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/93/233095.jpg'
  },
  howimetyourmother: {
    cleanTitle: 'How I Met Your Mother',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/219/549159.jpg'
  },
  thegreat: {
    cleanTitle: 'The Great',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/248/622002.jpg'
  },
  deathnote: {
    cleanTitle: 'Death Note',
    imageUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/568/1420650.jpg'
  }
};

export const FALLBACK_DIZI_BOOKMARKS: ShortcutItem[] = [
  {
    id: 'bm-series-seinfeld',
    name: 'Seinfeld',
    subtitle: '3. Sezon • 3. Bölüm',
    url: 'https://dizigom1.co/seinfeld-3-sezon-3-bolum-hd1/',
    category: 'bookmark',
    color: '#0891b2',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.seinfeld.imageUrl
  },
  {
    id: 'bm-series-themarvelousmrsmaisel',
    name: 'The Marvelous Mrs. Maisel',
    subtitle: '4. Sezon • 1. Bölüm',
    url: 'https://selcukflix.com/dizi/the-marvelous-mrs-maisel/sezon-4/bolum-1',
    category: 'bookmark',
    color: '#0d9488',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.themarvelousmrsmaisel.imageUrl
  },
  {
    id: 'bm-series-theoffice',
    name: 'The Office',
    subtitle: '4. Sezon • 12. Bölüm',
    url: 'https://dizigom1.co/the-office-4-sezon-12-bolum-hd1/',
    category: 'bookmark',
    color: '#0891b2',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.theoffice.imageUrl
  },
  {
    id: 'bm-series-thewhitelotus',
    name: 'The White Lotus',
    subtitle: '2. Sezon • 2. Bölüm',
    url: 'https://dizipal906.com/bolum/the-white-lotus-2x2',
    category: 'bookmark',
    color: '#4f46e5',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.thewhitelotus.imageUrl
  },
  {
    id: 'bm-series-friends',
    name: 'Friends',
    subtitle: '2. Sezon • 14. Bölüm',
    url: 'https://yabancidizi.io/dizi/friends/sezon-2/bolum-14',
    category: 'bookmark',
    color: '#d97706',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.friends.imageUrl
  },
  {
    id: 'bm-series-vikingler',
    name: 'Vikings',
    subtitle: '1. Sezon • 1. Bölüm',
    url: 'https://www.hdfilmcehennemi.nl/dizi/vikingler-izle-hdf18-22/sezon-1/bolum-1-hd1/',
    category: 'bookmark',
    color: '#ea580c',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.vikingler.imageUrl
  },
  {
    id: 'bm-series-howimetyourmother',
    name: 'How I Met Your Mother',
    subtitle: '1. Sezon • 5. Bölüm',
    url: 'https://filmmakinesi.to/dizi/how-i-met-your-mother-izle-2005-fm1/sezon-1/bolum-5/',
    category: 'bookmark',
    color: '#db2777',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.howimetyourmother.imageUrl
  },
  {
    id: 'bm-series-thegreat',
    name: 'The Great',
    subtitle: '2. Sezon • 5. Bölüm',
    url: 'https://filmmakinesi.to/dizi/the-great-izle-2020/sezon-2/bolum-5/',
    category: 'bookmark',
    color: '#db2777',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.thegreat.imageUrl
  },
  {
    id: 'bm-series-deathnote',
    name: 'Death Note',
    subtitle: '1. Sezon • 29. Bölüm',
    url: 'https://dizilla.now/death-note-1-sezon-29-bolum',
    category: 'bookmark',
    color: '#7c3aed',
    badge: '',
    imageUrl: SERIES_ARTWORK_BY_KEY.deathnote.imageUrl
  }
];

/**
 * Validates that a URL is strictly a safe https:// web URL with a valid hostname.
 * Prevents javascript:, data:, file:, or arbitrary local scheme execution.
 */
export function isSafeHttpsUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0 || rawUrl.length > 2048) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Parses and validates optional custom shortcuts from JSON string.
 */
export function parseCustomShortcuts(rawJson: string | undefined): ShortcutItem[] {
  if (!rawJson || !rawJson.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const result: ShortcutItem[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id.trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '';
      const url = typeof item.url === 'string' ? item.url.trim() : '';
      if (!id || !name || !isSafeHttpsUrl(url)) continue;

      const category =
        item.category === 'dizi_site' || item.category === 'bookmark' ? item.category : 'platform';
      const subtitle =
        typeof item.subtitle === 'string' && item.subtitle.trim()
          ? item.subtitle.trim().slice(0, 100)
          : '';
      const color =
        typeof item.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(item.color.trim())
          ? item.color.trim()
          : '#3b6b82';
      const badge =
        typeof item.badge === 'string' && item.badge.trim()
          ? item.badge.trim().slice(0, 6)
          : name.slice(0, 3).toUpperCase();
      const imageUrl =
        typeof item.imageUrl === 'string' && isSafeHttpsUrl(item.imageUrl.trim())
          ? item.imageUrl.trim()
          : undefined;

      result.push({
        id,
        name,
        subtitle,
        url,
        category,
        color,
        badge,
        ...(imageUrl ? { imageUrl } : {})
      });
    }
    return result;
  } catch {
    return [];
  }
}
