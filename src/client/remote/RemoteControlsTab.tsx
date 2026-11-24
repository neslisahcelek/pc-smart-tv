import React, { useEffect, useId, useRef, useState } from 'react';
import {
  BookmarkCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Hash,
  Home,
  Info,
  Minus,
  Monitor,
  Pause,
  Play,
  Plus,
  Power,
  Radio,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Tv,
  Undo2,
  Volume2,
  VolumeX,
  X
} from 'lucide-react';
import type {
  ActiveTabCandidate,
  NavigationDirection,
  PlayerStatus,
  ValidatedClientMessage,
  VestelKeyName,
  VestelProtocolVariant,
  VestelTvStatus
} from '../../shared/types.js';

interface RemoteControlsTabProps {
  vestelTv?: VestelTvStatus;
  playerStatus: PlayerStatus;
  volume: number;
  muted: boolean;
  activeTabCandidate?: ActiveTabCandidate | null;
  sendCommand: (msg: ValidatedClientMessage) => void;
  triggerFeedback: (label: string) => void;
}

const DEFAULT_VESTEL_STATUS: VestelTvStatus = {
  configuredHost: null,
  discoveredHost: null,
  activeHost: null,
  connected: false,
  discovering: false,
  protocolVariant: 'auto',
  detectedVariant: null,
  keepAwakeEnabled: false,
  keepAwakeIntervalMinutes: 45,
  lastKeepAwakeAt: null,
  lastError: null,
  favoriteChannels: [],
  volume: 20,
  muted: false,
  volumeSynced: false
};

export function RemoteControlsTab({
  vestelTv = DEFAULT_VESTEL_STATUS,
  playerStatus,
  volume,
  muted,
  activeTabCandidate,
  sendCommand,
  triggerFeedback
}: RemoteControlsTabProps) {
  const [dpadTarget, setDpadTarget] = useState<'tv' | 'pc'>('tv');
  const [showSettings, setShowSettings] = useState(false);
  const [showNumPad, setShowNumPad] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);
  const [dismissedErrorText, setDismissedErrorText] = useState<string | null>(null);

  const [hostInput, setHostInput] = useState(
    vestelTv.configuredHost ?? vestelTv.activeHost ?? ''
  );
  const [channelDigits, setChannelDigits] = useState('');
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelNumber, setNewChannelNumber] = useState('');
  const [confirmPowerOff, setConfirmPowerOff] = useState(false);

  // Optimistic local slider values while dragging so range thumbs track finger 1:1
  const [tvDraftVolume, setTvDraftVolume] = useState<number | null>(null);
  const [pcDraftVolume, setPcDraftVolume] = useState<number | null>(null);
  const tvLastSentAtRef = useRef<number>(0);
  const tvPendingCommitRef = useRef<number | null>(null);
  const pcLastSentAtRef = useRef<number>(0);

  const tvSliderId = useId();
  const pcSliderId = useId();

  const serverTvVolume = vestelTv.volume ?? 20;
  const serverTvMuted = Boolean(vestelTv.muted);
  const displayTvVolume = tvDraftVolume ?? serverTvVolume;
  const displayPcVolume = pcDraftVolume ?? volume;

  useEffect(() => {
    if (vestelTv.configuredHost) {
      setHostInput(vestelTv.configuredHost);
    } else if (vestelTv.discoveredHost && !hostInput) {
      setHostInput(vestelTv.discoveredHost);
    }
  }, [vestelTv.configuredHost, vestelTv.discoveredHost]);

  useEffect(() => {
    if (vestelTv.lastError && vestelTv.lastError !== dismissedErrorText) {
      setDismissedErrorText(null);
    }
  }, [vestelTv.lastError, dismissedErrorText]);

  useEffect(() => {
    if (!confirmPowerOff) return;
    const timer = window.setTimeout(() => setConfirmPowerOff(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmPowerOff]);

  useEffect(() => {
    return () => {
      if (tvPendingCommitRef.current !== null) {
        window.clearTimeout(tvPendingCommitRef.current);
      }
    };
  }, []);

  const sendTvKey = (key: VestelKeyName, label?: string) => {
    sendCommand({ type: 'TV_REMOTE_KEY', key });
    if (label) triggerFeedback(label);
  };

  const commitTvVolume = (nextVal: number, immediate = false) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextVal)));
    const now = Date.now();
    if (immediate || now - tvLastSentAtRef.current >= 95) {
      if (tvPendingCommitRef.current !== null) {
        window.clearTimeout(tvPendingCommitRef.current);
        tvPendingCommitRef.current = null;
      }
      tvLastSentAtRef.current = now;
      sendCommand({ type: 'TV_SET_VOLUME', volume: clamped });
      return;
    }

    if (tvPendingCommitRef.current !== null) {
      window.clearTimeout(tvPendingCommitRef.current);
    }
    tvPendingCommitRef.current = window.setTimeout(() => {
      tvPendingCommitRef.current = null;
      tvLastSentAtRef.current = Date.now();
      sendCommand({ type: 'TV_SET_VOLUME', volume: clamped });
    }, 100);
  };

  const handleTvSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = Number(e.target.value);
    setTvDraftVolume(nextVal);
    commitTvVolume(nextVal, false);
  };

  const handleTvSliderRelease = () => {
    if (tvDraftVolume !== null) {
      commitTvVolume(tvDraftVolume, true);
      setTvDraftVolume(null);
    }
  };

  const handlePcSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = Number(e.target.value);
    setPcDraftVolume(nextVal);
    const now = Date.now();
    if (now - pcLastSentAtRef.current >= 45) {
      pcLastSentAtRef.current = now;
      sendCommand({ type: 'SET_VOLUME', volume: nextVal });
    }
  };

  const handlePcSliderRelease = () => {
    if (pcDraftVolume !== null) {
      sendCommand({ type: 'SET_VOLUME', volume: pcDraftVolume });
      setPcDraftVolume(null);
    }
  };

  const handleDpad = (dir: NavigationDirection) => {
    if (dpadTarget === 'tv') {
      const map: Record<NavigationDirection, VestelKeyName> = {
        UP: 'UP',
        DOWN: 'DOWN',
        LEFT: 'LEFT',
        RIGHT: 'RIGHT',
        SELECT: 'OK'
      };
      sendTvKey(map[dir], dir === 'SELECT' ? 'TV OK' : undefined);
    } else {
      sendCommand({ type: 'NAVIGATE', direction: dir });
      if (dir === 'SELECT') triggerFeedback('PC Seçildi (OK)');
    }
  };

  const handleBack = () => {
    if (dpadTarget === 'tv') {
      sendTvKey('BACK', 'TV Geri');
    } else {
      sendCommand({ type: 'COMMAND', action: 'GO_BACK' });
      triggerFeedback('Geri');
    }
  };

  const handleSaveHost = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = hostInput.trim();
    sendCommand({
      type: 'TV_SET_CONFIG',
      host: trimmed.length > 0 ? trimmed : null
    });
    triggerFeedback(trimmed ? `TV IP kaydedildi: ${trimmed}` : 'TV IP temizlendi');
  };

  const handleTuneInputDigits = () => {
    const num = Number(channelDigits);
    if (!Number.isInteger(num) || num < 1 || num > 9999) {
      triggerFeedback('Geçerli kanal no girin (1-9999)');
      return;
    }
    sendCommand({ type: 'TV_TUNE_CHANNEL', channelNumber: num });
    triggerFeedback(`Kanal ${num} açılıyor...`);
    setChannelDigits('');
  };

  const handleSaveFavorite = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(newChannelNumber);
    if (!newChannelName.trim() || !Number.isInteger(num) || num < 1 || num > 9999) {
      triggerFeedback('Kanal adı ve no (1-9999) girin');
      return;
    }
    sendCommand({
      type: 'TV_SAVE_FAVORITE_CHANNEL',
      name: newChannelName.trim(),
      channelNumber: num
    });
    triggerFeedback(`Favori eklendi: ${num} - ${newChannelName.trim()}`);
    setNewChannelName('');
    setNewChannelNumber('');
    setShowAddChannel(false);
  };

  const visibleError =
    vestelTv.lastError && vestelTv.lastError !== dismissedErrorText ? vestelTv.lastError : null;

  const lastKeepAwakeLabel = vestelTv.lastKeepAwakeAt
    ? new Date(vestelTv.lastKeepAwakeAt).toLocaleTimeString('tr-TR', {
        hour: '2-digit',
        minute: '2-digit'
      })
    : null;

  return (
    <div className="remote-tab-pane kumanda-pane">
      {/* 1. Compact TV Connection & Power Header */}
      <div className="kumanda-tv-bar">
        <div className="kumanda-tv-status">
          <span
            className={`vestel-status-dot ${
              vestelTv.connected
                ? 'is-online'
                : vestelTv.activeHost
                  ? 'is-standby'
                  : 'is-offline'
            }`}
          />
          <span className="kumanda-tv-host">
            {vestelTv.discovering
              ? 'TV aranıyor...'
              : vestelTv.activeHost
                ? `Vestel ${vestelTv.activeHost}`
                : 'TV bağlı değil'}
          </span>
          {!vestelTv.activeHost && !vestelTv.discovering && (
            <button
              type="button"
              className="kumanda-pill-btn is-accent"
              onClick={() => {
                sendCommand({ type: 'TV_DISCOVER' });
                triggerFeedback('Ağda Vestel TV aranıyor...');
              }}
            >
              <Search size={12} strokeWidth={2.4} /> TV Ara
            </button>
          )}
        </div>

        <div className="kumanda-tv-actions">
          <button
            type="button"
            className={`kumanda-pill-btn ${vestelTv.keepAwakeEnabled ? 'is-active' : ''}`}
            title="Otomatik Uyku Önleyici (Keep-Awake)"
            onClick={() => {
              const next = !vestelTv.keepAwakeEnabled;
              sendCommand({ type: 'TV_SET_CONFIG', keepAwakeEnabled: next });
              triggerFeedback(next ? 'Uyku Önleyici Açık' : 'Uyku Önleyici Kapalı');
            }}
          >
            <Sparkles size={12} strokeWidth={2.3} />
            <span>{vestelTv.keepAwakeEnabled ? 'Uyanık' : 'Uyku Önle'}</span>
          </button>

          <button
            type="button"
            className={`kumanda-icon-btn ${showSettings ? 'is-active' : ''}`}
            aria-label="TV Bağlantı Ayarları"
            onClick={() => setShowSettings((prev) => !prev)}
          >
            <SlidersHorizontal size={15} strokeWidth={2.2} />
          </button>

          <button
            type="button"
            className={`kumanda-icon-btn is-power ${confirmPowerOff ? 'is-confirm' : ''}`}
            aria-label={confirmPowerOff ? 'Kapatmayı Onayla' : 'TV Kapat'}
            title={confirmPowerOff ? 'Kapatmak için tekrar dokunun' : 'TV Kapat (Standby)'}
            onClick={() => {
              if (!confirmPowerOff) {
                setConfirmPowerOff(true);
                triggerFeedback('TV kapatmak için güç tuşuna tekrar basın');
                return;
              }
              setConfirmPowerOff(false);
              sendTvKey('POWER', 'TV Güç (Standby) gönderildi');
            }}
          >
            <Power size={15} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {/* Dismissible compact error notice */}
      {visibleError && (
        <div className="kumanda-error-pill" role="alert">
          <span>{visibleError}</span>
          <button
            type="button"
            className="kumanda-error-close"
            aria-label="Hatayı kapat"
            onClick={() => setDismissedErrorText(visibleError)}
          >
            <X size={13} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* Collapsible TV Settings Drawer */}
      {showSettings && (
        <section className="kumanda-settings-drawer">
          <div className="kumanda-settings-top">
            <strong>Vestel TV Ağ Ayarları</strong>
            <button
              type="button"
              className="remote-btn remote-btn-accent remote-btn-sm"
              disabled={vestelTv.discovering}
              onClick={() => {
                sendCommand({ type: 'TV_DISCOVER' });
                triggerFeedback('Ağda TV aranıyor...');
              }}
            >
              <Search size={13} strokeWidth={2.2} />{' '}
              {vestelTv.discovering ? 'Aranıyor...' : 'Ağda Tara'}
            </button>
          </div>

          <form className="vestel-ip-form" onSubmit={handleSaveHost}>
            <input
              type="text"
              inputMode="decimal"
              className="remote-search-input vestel-ip-input"
              placeholder="TV IP (örn. 192.168.1.50)"
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <button type="submit" className="remote-btn remote-btn-accent remote-btn-sm">
              Kaydet
            </button>
          </form>

          <div className="kumanda-settings-grid">
            <label className="kumanda-field">
              <span>Protokol</span>
              <select
                className="vestel-select"
                value={vestelTv.protocolVariant}
                onChange={(e) => {
                  sendCommand({
                    type: 'TV_SET_CONFIG',
                    protocolVariant: e.target.value as VestelProtocolVariant
                  });
                  triggerFeedback(`Protokol: ${e.target.value}`);
                }}
              >
                <option value="auto">Otomatik</option>
                <option value="vr_remote">VR Remote (:56789)</option>
                <option value="smartcenter">SmartCenter (:56789)</option>
                <option value="raw_tcp">Klasik TCP (:4660)</option>
              </select>
            </label>

            <label className="kumanda-field">
              <span>Uyku Önleme</span>
              <select
                className="vestel-select"
                value={vestelTv.keepAwakeIntervalMinutes}
                onChange={(e) => {
                  sendCommand({
                    type: 'TV_SET_CONFIG',
                    keepAwakeIntervalMinutes: Number(e.target.value)
                  });
                  triggerFeedback(`Aralık: ${e.target.value} dk`);
                }}
              >
                <option value={30}>30 dk</option>
                <option value={45}>45 dk</option>
                <option value={60}>60 dk</option>
                <option value={90}>90 dk</option>
              </select>
            </label>
          </div>

          <div className="kumanda-settings-footer">
            <span>
              TV: <strong>Ayarlar → Sistem → Daha Fazla → Sanal Kumanda: Açık</strong>
              {lastKeepAwakeLabel ? ` · Son sinyal: ${lastKeepAwakeLabel}` : ''}
            </span>
            <button
              type="button"
              className="kumanda-pill-btn"
              onClick={() => {
                sendCommand({ type: 'TV_DISMISS_SLEEP_PROMPT', strategy: 'right_ok' });
                triggerFeedback('Sağ + OK (Hayır) gönderildi');
              }}
            >
              Sağ+OK ile Hayır
            </button>
          </div>
        </section>
      )}

      {/* 2. PRIMARY CARD AT TOP: TV & PC Volume Sliders */}
      <section className="kumanda-volume-card" aria-label="Ses Kontrolleri">
        {/* TV Volume */}
        <div className="kumanda-vol-block">
          <div className="kumanda-vol-header">
            <label htmlFor={tvSliderId} className="kumanda-vol-label">
              <Tv size={14} strokeWidth={2.3} />
              <span>TV Ses</span>
            </label>
            <div className="kumanda-vol-controls">
              <button
                type="button"
                className="kumanda-step-btn"
                aria-label="TV Ses Azalt"
                onClick={() => sendTvKey('VOL_DOWN')}
              >
                <Minus size={14} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                className={`kumanda-mute-pill ${serverTvMuted ? 'is-muted' : ''}`}
                aria-label={serverTvMuted ? 'TV Sesi Aç' : 'TV Sessize Al'}
                onClick={() => sendTvKey('MUTE', serverTvMuted ? 'TV Ses Açık' : 'TV Sessiz')}
              >
                {serverTvMuted ? (
                  <VolumeX size={13} strokeWidth={2.3} />
                ) : (
                  <Volume2 size={13} strokeWidth={2.3} />
                )}
                <span>{serverTvMuted ? 'Sessiz' : `%${displayTvVolume}`}</span>
              </button>
              <button
                type="button"
                className="kumanda-step-btn"
                aria-label="TV Ses Artır"
                onClick={() => sendTvKey('VOL_UP')}
              >
                <Plus size={14} strokeWidth={2.5} />
              </button>
            </div>
          </div>
          <input
            id={tvSliderId}
            type="range"
            min={0}
            max={100}
            value={displayTvVolume}
            className="remote-range-slider"
            aria-label="TV Ses Seviyesi"
            aria-valuetext={serverTvMuted ? 'Sessiz' : `%${displayTvVolume}`}
            style={
              {
                '--attr-min': 0,
                '--attr-max': 100,
                '--control-value': displayTvVolume
              } as React.CSSProperties
            }
            onChange={handleTvSliderChange}
            onPointerUp={handleTvSliderRelease}
            onTouchEnd={handleTvSliderRelease}
            onBlur={handleTvSliderRelease}
          />
        </div>

        {/* PC Volume */}
        <div className="kumanda-vol-block kumanda-vol-block-secondary">
          <div className="kumanda-vol-header">
            <label htmlFor={pcSliderId} className="kumanda-vol-label">
              <Monitor size={14} strokeWidth={2.3} />
              <span>PC Ses</span>
            </label>
            <div className="kumanda-vol-controls">
              <button
                type="button"
                className={`kumanda-mute-pill ${muted ? 'is-muted' : ''}`}
                aria-label={muted ? 'PC Sesi Aç' : 'PC Sessize Al'}
                onClick={() => sendCommand({ type: 'COMMAND', action: 'TOGGLE_MUTE' })}
              >
                {muted ? (
                  <VolumeX size={13} strokeWidth={2.3} />
                ) : (
                  <Volume2 size={13} strokeWidth={2.3} />
                )}
                <span>{muted ? 'Sessiz' : `%${displayPcVolume}`}</span>
              </button>
            </div>
          </div>
          <input
            id={pcSliderId}
            type="range"
            min={0}
            max={100}
            value={displayPcVolume}
            className="remote-range-slider"
            aria-label="PC Ses Seviyesi"
            aria-valuetext={muted ? 'Sessiz' : `%${displayPcVolume}`}
            style={
              {
                '--attr-min': 0,
                '--attr-max': 100,
                '--control-value': displayPcVolume
              } as React.CSSProperties
            }
            onChange={handlePcSliderChange}
            onPointerUp={handlePcSliderRelease}
            onTouchEnd={handlePcSliderRelease}
            onBlur={handlePcSliderRelease}
          />
        </div>
      </section>

      {/* 3. Compact Quick Actions Strip */}
      <div className="kumanda-quick-strip">
        <button
          type="button"
          className="kumanda-quick-btn"
          onClick={() => sendTvKey('SOURCE', 'Kaynak / HDMI')}
        >
          <Monitor size={17} strokeWidth={2.2} />
          <span>Kaynak</span>
        </button>

        <button
          type="button"
          className="kumanda-quick-btn"
          onClick={() => {
            sendCommand({ type: 'COMMAND', action: 'TOGGLE_PLAY' });
            triggerFeedback('Oynat / Duraklat');
          }}
        >
          {playerStatus === 'playing' ? (
            <Pause size={17} strokeWidth={2.2} fill="currentColor" />
          ) : (
            <Play size={17} strokeWidth={2.2} fill="currentColor" />
          )}
          <span>Oynat</span>
        </button>

        <button
          type="button"
          className="kumanda-quick-btn is-accent"
          onClick={() => {
            sendCommand({ type: 'TV_DISMISS_SLEEP_PROMPT', strategy: 'exit' });
            triggerFeedback('TV uyarısı kapatıldı (Hayır)');
          }}
        >
          <ShieldAlert size={17} strokeWidth={2.2} />
          <span>Uyarı Kapat</span>
        </button>

        <button
          type="button"
          className="kumanda-quick-btn"
          onClick={() => {
            sendCommand({ type: 'COMMAND', action: 'GO_HOME' });
            triggerFeedback('Ana Ekran');
          }}
        >
          <Home size={17} strokeWidth={2.2} />
          <span>Ana Ekran</span>
        </button>
      </div>

      {/* 4. Compact D-Pad Navigation Card */}
      <section className="remote-dpad-card kumanda-dpad-compact">
        <div className="kumanda-dpad-header">
          <button type="button" className="kumanda-corner-btn" onClick={handleBack}>
            <Undo2 size={14} strokeWidth={2.2} /> Geri
          </button>

          <div className="kumanda-target-switch" role="group" aria-label="Yönlendirme Hedefi">
            <button
              type="button"
              className={dpadTarget === 'tv' ? 'is-active' : ''}
              onClick={() => setDpadTarget('tv')}
            >
              TV
            </button>
            <button
              type="button"
              className={dpadTarget === 'pc' ? 'is-active' : ''}
              onClick={() => setDpadTarget('pc')}
            >
              PC
            </button>
          </div>

          <button
            type="button"
            className="kumanda-corner-btn"
            onClick={() => sendTvKey('EXIT', 'TV Çıkış')}
          >
            <X size={14} strokeWidth={2.2} /> Çıkış
          </button>
        </div>

        <div className="remote-dpad-grid kumanda-dpad-grid-compact">
          <div />
          <button
            type="button"
            className="remote-dpad-btn"
            aria-label="Yukarı"
            onClick={() => handleDpad('UP')}
          >
            <ChevronUp size={24} strokeWidth={2.5} />
          </button>
          <div />

          <button
            type="button"
            className="remote-dpad-btn"
            aria-label="Sol"
            onClick={() => handleDpad('LEFT')}
          >
            <ChevronLeft size={24} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            className="remote-dpad-btn remote-dpad-ok"
            aria-label="Seç (OK)"
            onClick={() => handleDpad('SELECT')}
          >
            OK
          </button>
          <button
            type="button"
            className="remote-dpad-btn"
            aria-label="Sağ"
            onClick={() => handleDpad('RIGHT')}
          >
            <ChevronRight size={24} strokeWidth={2.5} />
          </button>

          <div />
          <button
            type="button"
            className="remote-dpad-btn"
            aria-label="Aşağı"
            onClick={() => handleDpad('DOWN')}
          >
            <ChevronDown size={24} strokeWidth={2.5} />
          </button>
          <div />
        </div>

        <div className="kumanda-subkeys-row">
          <button
            type="button"
            className="kumanda-subkey-btn"
            onClick={() => sendTvKey('MENU', 'TV Menü')}
          >
            <Tv size={13} strokeWidth={2.2} /> Menü
          </button>
          <button
            type="button"
            className="kumanda-subkey-btn"
            onClick={() => sendTvKey('INFO', 'Bilgi')}
          >
            <Info size={13} strokeWidth={2.2} /> Info
          </button>
          <button
            type="button"
            className="kumanda-subkey-btn"
            onClick={() => sendTvKey('TV_DTV', 'TV / Kanallar')}
          >
            <Radio size={13} strokeWidth={2.2} /> TV/DTV
          </button>
          <button
            type="button"
            className={`kumanda-subkey-btn ${showNumPad ? 'is-active' : ''}`}
            onClick={() => setShowNumPad((prev) => !prev)}
          >
            <Hash size={13} strokeWidth={2.2} /> 123
          </button>
        </div>
      </section>

      {/* Collapsible 0-9 Number Pad */}
      {showNumPad && (
        <section className="vestel-card">
          <div className="vestel-channel-entry">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={9999}
              className="remote-search-input vestel-ip-input"
              placeholder="Kanal no (örn. 24)"
              value={channelDigits}
              onChange={(e) => setChannelDigits(e.target.value)}
            />
            <button
              type="button"
              className="remote-btn remote-btn-accent remote-btn-sm"
              onClick={handleTuneInputDigits}
            >
              Git
            </button>
          </div>

          <div className="vestel-numpad-grid">
            {(['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const).map((digit) => (
              <button
                key={digit}
                type="button"
                className="vestel-numpad-btn"
                onClick={() => sendTvKey(`NUM_${digit}` as VestelKeyName, `Tuş ${digit}`)}
              >
                {digit}
              </button>
            ))}
            <button
              type="button"
              className="vestel-numpad-btn vestel-numpad-fn"
              onClick={() => sendTvKey('BACK', 'Geri')}
            >
              Geri
            </button>
            <button
              type="button"
              className="vestel-numpad-btn"
              onClick={() => sendTvKey('NUM_0', 'Tuş 0')}
            >
              0
            </button>
            <button
              type="button"
              className="vestel-numpad-btn vestel-numpad-ok"
              onClick={() => sendTvKey('OK', 'OK')}
            >
              OK
            </button>
          </div>
        </section>
      )}

      {/* 5. Unified Channels Card (CH +/- + Favorite Channels) */}
      <section className="kumanda-fav-section">
        <div className="kumanda-fav-header">
          <span className="kumanda-deck-label">Kanallar</span>
          <div className="kumanda-ch-inline">
            <button
              type="button"
              className="kumanda-ch-step-btn"
              aria-label="Önceki Kanal"
              onClick={() => sendTvKey('CH_DOWN', 'CH -')}
            >
              <ChevronDown size={15} strokeWidth={2.5} />
              <span>CH-</span>
            </button>
            <button
              type="button"
              className="kumanda-ch-step-btn"
              aria-label="Sonraki Kanal"
              onClick={() => sendTvKey('CH_UP', 'CH +')}
            >
              <ChevronUp size={15} strokeWidth={2.5} />
              <span>CH+</span>
            </button>
            <button
              type="button"
              className="kumanda-pill-btn"
              onClick={() => setShowAddChannel((prev) => !prev)}
            >
              <Plus size={12} strokeWidth={2.4} /> Ekle
            </button>
          </div>
        </div>

        {showAddChannel && (
          <form className="vestel-add-channel-form" onSubmit={handleSaveFavorite}>
            <input
              type="text"
              maxLength={40}
              className="remote-search-input vestel-ip-input"
              placeholder="Kanal Adı (örn. TRT 1)"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
            />
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={9999}
              className="remote-search-input vestel-ch-num-input"
              placeholder="No"
              value={newChannelNumber}
              onChange={(e) => setNewChannelNumber(e.target.value)}
            />
            <button type="submit" className="remote-btn remote-btn-accent remote-btn-sm">
              Ekle
            </button>
          </form>
        )}

        {vestelTv.favoriteChannels.length > 0 && (
          <div className="vestel-fav-grid">
            {vestelTv.favoriteChannels.map((ch) => (
              <div key={ch.id} className="vestel-fav-chip">
                <button
                  type="button"
                  className="vestel-fav-btn"
                  onClick={() => {
                    sendCommand({ type: 'TV_TUNE_CHANNEL', channelNumber: ch.channelNumber });
                    triggerFeedback(`${ch.channelNumber} - ${ch.name}`);
                  }}
                >
                  <span className="vestel-fav-num">{ch.channelNumber}</span>
                  <span className="vestel-fav-name">{ch.name}</span>
                </button>
                <button
                  type="button"
                  className="vestel-fav-del"
                  aria-label={`${ch.name} kanalını sil`}
                  onClick={() => {
                    sendCommand({ type: 'TV_DELETE_FAVORITE_CHANNEL', id: ch.id });
                    triggerFeedback(`${ch.name} silindi`);
                  }}
                >
                  <Trash2 size={13} strokeWidth={2.2} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Active TV Episode / Save Progress Prompt */}
      {activeTabCandidate && (
        <div className="remote-active-tab-card">
          <header className="remote-active-tab-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Tv size={16} strokeWidth={2.2} />
              TV&apos;de Açık Dizi
            </span>
            <span>Canlı</span>
          </header>
          <div className="remote-active-tab-title">
            {activeTabCandidate.title || activeTabCandidate.url}
          </div>
          <button
            type="button"
            className="remote-btn remote-btn-accent remote-btn-full"
            onClick={() => {
              sendCommand({
                type: 'SAVE_PROGRESS',
                url: activeTabCandidate.url,
                title: activeTabCandidate.title
              });
              triggerFeedback('Kaldığın yer kaydedildi!');
            }}
          >
            <BookmarkCheck size={16} strokeWidth={2.2} /> Kaldığım Yeri Kaydet
          </button>
        </div>
      )}
    </div>
  );
}
