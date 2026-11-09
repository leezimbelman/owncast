import { useMemo } from 'react';
import { useSelectedLanguage, useTranslation } from 'next-export-i18n';
import type { Translations } from '@videojs/react';
import { Localization } from '../../../types/localization';

const KEYS = Localization.Frontend.Player;

const ENGLISH: Record<keyof typeof KEYS, string> = {
  play: 'Play',
  pause: 'Pause',
  mute: 'Mute',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  pictureInPicture: 'Picture-in-picture',
  exitPictureInPicture: 'Exit picture-in-picture',
  airplay: 'AirPlay',
  live: 'Live',
  goLive: 'Go live',
  settings: 'Settings',
  quality: 'Quality',
  minimizeLatency: 'Minimize latency',
  minimizeLatencyDescription:
    'Experimental: slightly speeds up playback to keep you closer to live',
  on: 'ON',
  off: 'OFF',
  playbackError: 'Playback failed. The stream may have ended or your connection was interrupted.',
  player: 'Video player',
  // The v10 menu and volume slider strings keep the package's {label},
  // {value} and {percent} placeholders, which @videojs/react fills in.
  auto: 'Auto',
  autoWithLabel: 'Auto ({label})',
  volume: 'Volume',
  volumeValue: 'Volume {value}',
  volumeMuted: 'Muted',
  volumeMutedValue: '{percent}, muted',
};

export type PlayerLabels = Record<keyof typeof KEYS, string> & { unmute: string };

// next-export-i18n returns the key itself when a translation is missing;
// fall back to English in that case, mirroring the Translation component.
const withFallback = (translated: string, key: string, fallback: string) =>
  translated === key ? fallback : translated;

export function usePlayerLabels(): PlayerLabels {
  const { t } = useTranslation();
  const { lang } = useSelectedLanguage();
  return useMemo(() => {
    const labels = Object.fromEntries(
      (Object.keys(KEYS) as Array<keyof typeof KEYS>).map(name => [
        name,
        withFallback(t(KEYS[name]), KEYS[name], ENGLISH[name]),
      ]),
    ) as Record<keyof typeof KEYS, string>;
    return {
      ...labels,
      unmute: withFallback(t(Localization.Frontend.unmute), Localization.Frontend.unmute, 'Unmute'),
    };
    // t is excluded: useTranslation returns a new function each render but reads the same lang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);
}

// Overrides for @videojs/react's I18nProvider so the built-in buttons
// announce Owncast's translated labels instead of the package's English.
export function playerI18nOverrides(labels: PlayerLabels): Partial<Translations> {
  return {
    buttons: { play: labels.play, pause: labels.pause, mute: labels.mute, unmute: labels.unmute },
    fullscreen: { enter: labels.fullscreen, exit: labels.exitFullscreen },
    pip: { enter: labels.pictureInPicture, exit: labels.exitPictureInPicture },
    airplay: { start: labels.airplay, stop: labels.airplay },
    live: { badge: labels.live, playing: labels.live, seekToEdge: labels.goLive },
    menu: {
      settings: labels.settings,
      quality: labels.quality,
      auto: labels.auto,
      autoWithLabel: labels.autoWithLabel,
    },
    volume: {
      label: labels.volume,
      value: labels.volumeValue,
      muted: labels.volumeMuted,
      mutedValue: labels.volumeMutedValue,
    },
    container: { label: labels.player },
  };
}
