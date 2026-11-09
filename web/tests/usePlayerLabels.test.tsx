import { renderHook } from '@testing-library/react';
import { playerI18nOverrides, usePlayerLabels } from '../components/video/player/usePlayerLabels';
import { Localization } from '../types/localization';

const mockState = { lang: 'en' };

jest.mock('next-export-i18n', () => ({
  useSelectedLanguage: () => ({ lang: mockState.lang }),
  // New function identity on every call, like the real library.
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'Frontend.Player.play': 'Jouer',
      };
      return translations[key] ?? key;
    },
  }),
}));

describe('usePlayerLabels', () => {
  beforeEach(() => {
    mockState.lang = 'en';
  });

  test('returns a translated value when the key exists', () => {
    const { result } = renderHook(() => usePlayerLabels());
    expect(Localization.Frontend.Player.play).toBe('Frontend.Player.play');
    expect(result.current.play).toBe('Jouer');
  });

  test('falls back to English when the key is missing', () => {
    const { result } = renderHook(() => usePlayerLabels());
    expect(result.current.pause).toBe('Pause');
    expect(result.current.exitFullscreen).toBe('Exit fullscreen');
  });

  test('falls back to Unmute for the unmute label', () => {
    const { result } = renderHook(() => usePlayerLabels());
    expect(result.current.unmute).toBe('Unmute');
  });

  test('is referentially stable across renders with the same language', () => {
    const { result, rerender } = renderHook(() => usePlayerLabels());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  test('recomputes when the language changes', () => {
    const { result, rerender } = renderHook(() => usePlayerLabels());
    const first = result.current;
    mockState.lang = 'fr';
    rerender();
    expect(result.current).not.toBe(first);
  });

  test('maps menu and volume strings with the package placeholders intact', () => {
    const { result } = renderHook(() => usePlayerLabels());
    const overrides = playerI18nOverrides(result.current);
    expect(overrides.menu).toMatchObject({ auto: 'Auto', autoWithLabel: 'Auto ({label})' });
    expect(overrides.volume).toEqual({
      label: 'Volume',
      value: 'Volume {value}',
      muted: 'Muted',
      mutedValue: '{percent}, muted',
    });
  });
});
