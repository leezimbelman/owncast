import {
  addCachebuster,
  buildHlsConfig,
  DEFAULT_LATENCY_PROFILE,
  LOW_LATENCY_PROFILE,
  requestKindForContextType,
} from '../components/video/player/hlsConfig';

const fakeXhr = () => ({ open: jest.fn() });

describe('hlsConfig', () => {
  test('classifies hls.js loader contexts', () => {
    expect(requestKindForContextType('manifest')).toBe('playlist');
    expect(requestKindForContextType('level')).toBe('playlist');
    expect(requestKindForContextType('media-fragment')).toBe('segment');
    expect(requestKindForContextType('key')).toBeNull();
  });

  test('adds a six character cachebuster to playlist urls', () => {
    const url = addCachebuster('http://localhost:8080/hls/stream.m3u8', () => 0.123456789);
    const cachebust = new URL(url).searchParams.get('cachebust');
    expect(cachebust).toHaveLength(6);
    expect(cachebust).toBe((0.123456789).toString(16).slice(2, 8));
  });

  test('default profile uses hls.js live sync defaults', () => {
    const config = buildHlsConfig({ latencyProfile: 'default' });
    expect(config).toMatchObject(DEFAULT_LATENCY_PROFILE);
    expect(config.startLevel).toBe(0);
    expect(config.liveSyncDuration).toBeUndefined();
  });

  test('low profile tightens the live window with counts only', () => {
    const config = buildHlsConfig({ latencyProfile: 'low' });
    expect(config).toMatchObject(LOW_LATENCY_PROFILE);
    expect(config.liveSyncDurationCount).toBe(2);
    expect(config.liveMaxLatencyDurationCount).toBe(4);
    expect(config.maxLiveSyncPlaybackRate).toBe(1.08);
    expect(config.liveSyncDuration).toBeUndefined();
    expect(config.liveMaxLatencyDuration).toBeUndefined();
  });

  test('xhrSetup rewrites playlist requests with cachebuster and CMCD', () => {
    const decorator = { decorateUrl: jest.fn((url: string) => `${url}&CMCD=x`) };
    const config = buildHlsConfig({ latencyProfile: 'default', decorator });
    const xhr = fakeXhr();
    config.xhrSetup!(xhr as any, 'http://h/hls/stream.m3u8', { type: 'level' } as any);
    expect(decorator.decorateUrl).toHaveBeenCalledWith(
      expect.stringContaining('cachebust='),
      'playlist',
    );
    const opened = xhr.open.mock.calls[0][1] as string;
    expect(opened).toContain('cachebust=');
    expect(opened).toContain('CMCD=x');
  });

  test('xhrSetup decorates segments without a cachebuster', () => {
    const decorator = { decorateUrl: jest.fn((url: string) => `${url}?CMCD=y`) };
    const config = buildHlsConfig({ latencyProfile: 'default', decorator });
    const xhr = fakeXhr();
    config.xhrSetup!(xhr as any, 'http://h/hls/0/stream-1.ts', { type: 'media-fragment' } as any);
    expect(decorator.decorateUrl).toHaveBeenCalledWith('http://h/hls/0/stream-1.ts', 'segment');
    expect(xhr.open).toHaveBeenCalledWith('GET', 'http://h/hls/0/stream-1.ts?CMCD=y', true);
  });

  test('xhrSetup leaves other requests alone and survives decorator errors', () => {
    const decorator = {
      decorateUrl: jest.fn(() => {
        throw new Error('boom');
      }),
    };
    const config = buildHlsConfig({ latencyProfile: 'default', decorator });
    const xhr = fakeXhr();
    config.xhrSetup!(xhr as any, 'http://h/key', { type: 'key' } as any);
    expect(xhr.open).not.toHaveBeenCalled();
    config.xhrSetup!(xhr as any, 'http://h/hls/0/stream-1.ts', { type: 'media-fragment' } as any);
    expect(xhr.open).not.toHaveBeenCalled();
  });
});
