import { act, renderHook } from '@testing-library/react';
import { useAutoplay } from '../components/video/player/useAutoplay';

class FakeMedia extends EventTarget {
  muted = false;

  volume = 1;

  play = jest.fn<Promise<void>, []>(() => Promise.resolve());

  loadstart() {
    this.dispatchEvent(new Event('loadstart'));
  }

  setVolume(volume: number, muted = false) {
    this.volume = volume;
    this.muted = muted;
    this.dispatchEvent(new Event('volumechange'));
  }
}

const blockedUnlessMuted = (media: FakeMedia) =>
  jest.fn<Promise<void>, []>(() =>
    media.muted ? Promise.resolve() : Promise.reject(new Error('NotAllowedError')),
  );

const flush = () => act(async () => {});

describe('useAutoplay', () => {
  test('mode false never calls play', async () => {
    const media = new FakeMedia();
    renderHook(() => useAutoplay(media, false, false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).not.toHaveBeenCalled();
  });

  test("mode 'play' plays audibly and leaves the flag off", async () => {
    const media = new FakeMedia();
    const { result } = renderHook(() => useAutoplay(media, 'play', false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(media.muted).toBe(false);
    expect(result.current).toBe(false);
  });

  test("mode 'play' stays paused when blocked", async () => {
    const media = new FakeMedia();
    media.play = blockedUnlessMuted(media);
    const { result } = renderHook(() => useAutoplay(media, 'play', false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(media.muted).toBe(false);
    expect(result.current).toBe(false);
  });

  test("mode 'any' falls back to muted playback and sets the flag", async () => {
    const media = new FakeMedia();
    media.play = blockedUnlessMuted(media);
    const { result } = renderHook(() => useAutoplay(media, 'any', false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(2);
    expect(media.muted).toBe(true);
    expect(result.current).toBe(true);
  });

  test('the flag clears once the viewer makes playback audible', async () => {
    const media = new FakeMedia();
    media.play = blockedUnlessMuted(media);
    const { result } = renderHook(() => useAutoplay(media, 'any', false));
    act(() => media.loadstart());
    await flush();
    expect(result.current).toBe(true);
    act(() => media.setVolume(0.7, false));
    expect(result.current).toBe(false);
  });

  test('a viewer-chosen inaudible start never sets the flag', async () => {
    const media = new FakeMedia();
    media.volume = 0;
    const { result } = renderHook(() => useAutoplay(media, 'any', true));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
  });

  test('a second loadstart does not call play again', async () => {
    const media = new FakeMedia();
    renderHook(() => useAutoplay(media, 'any', false));
    act(() => media.loadstart());
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  test("a later loadstart does not flag a viewer's mute as autoplay", async () => {
    const media = new FakeMedia();
    const { result } = renderHook(() => useAutoplay(media, 'play', false));
    act(() => media.loadstart());
    await flush();
    expect(result.current).toBe(false);
    act(() => media.setVolume(0.7, true));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
  });

  test('the fallback is not applied after unmount', async () => {
    const media = new FakeMedia();
    let reject: (reason: Error) => void = () => {};
    media.play = jest.fn<Promise<void>, []>(
      () =>
        new Promise<void>((_, rej) => {
          reject = rej;
        }),
    );
    const { unmount } = renderHook(() => useAutoplay(media, 'any', false));
    act(() => media.loadstart());
    unmount();
    reject(new Error('NotAllowedError'));
    await flush();
    expect(media.muted).toBe(false);
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  test("'any' stays silent when even the muted retry is rejected", async () => {
    const media = new FakeMedia();
    media.play = jest.fn<Promise<void>, []>(() => Promise.reject(new Error('NotAllowedError')));
    const { result } = renderHook(() => useAutoplay(media, 'any', false));
    act(() => media.loadstart());
    await flush();
    expect(media.play).toHaveBeenCalledTimes(2);
    expect(media.muted).toBe(true);
    expect(result.current).toBe(false);
  });

  test('the flag resets when media changes', async () => {
    const mediaA = new FakeMedia();
    mediaA.play = blockedUnlessMuted(mediaA);
    const mediaB = new FakeMedia();
    const { result, rerender } = renderHook(({ media }) => useAutoplay(media, 'any', false), {
      initialProps: { media: mediaA },
    });
    act(() => mediaA.loadstart());
    await flush();
    expect(result.current).toBe(true);
    rerender({ media: mediaB });
    expect(result.current).toBe(false);
  });

  test('does nothing without media', () => {
    const { result } = renderHook(() => useAutoplay(null, 'any', false));
    expect(result.current).toBe(false);
  });
});
