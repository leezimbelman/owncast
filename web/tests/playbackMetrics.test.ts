import PlaybackMetrics from '../components/video/metrics/playback';

class FakeMedia extends EventTarget {
  paused = false;

  ended = false;

  seeking = false;

  currentTime = 0;

  playbackRate = 1;

  error: { code: number } | null = null;

  buffered = { length: 0, end: () => 0 };

  trigger(event: string) {
    this.dispatchEvent(new Event(event));
  }
}

type FragHandler = (event: string, data: unknown) => void;

const makeHls = () => {
  const handlers = new Map<string, FragHandler>();
  return {
    bandwidthEstimate: 2_560_000,
    currentLevel: 1,
    levels: [{ bitrate: 800_000 }, { bitrate: 1_500_000 }],
    playingDate: null as Date | null,
    on: jest.fn((event: string, handler: FragHandler) => handlers.set(event, handler)),
    off: jest.fn((event: string) => handlers.delete(event)),
    emit: (event: string, data: unknown) => handlers.get(event)?.(event, data),
  };
};

const reports = () =>
  (global.fetch as jest.Mock).mock.calls.map(([, init]) => JSON.parse(init.body));

describe('PlaybackMetrics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn(() => Promise.resolve({})) as jest.Mock;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('reports ended when a started player is torn down', async () => {
    const media = new FakeMedia();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);

    media.trigger('playing');
    await Promise.resolve();
    metrics.stop();
    await Promise.resolve();

    expect(reports().map(report => report.sta)).toEqual(['p', 'e']);
  });

  test('reports a pause after playback starts', async () => {
    const media = new FakeMedia();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);

    media.trigger('playing');
    media.trigger('pause');
    await Promise.resolve();

    expect(reports().map(report => report.sta)).toEqual(['p', 'a']);
    metrics.stop();
  });

  test('keeps a paused session fresh beyond the server stale timeout', async () => {
    const media = new FakeMedia();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);

    media.trigger('playing');
    media.paused = true;
    media.trigger('pause');
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(reports().map(report => report.sta)).toEqual(['p', 'a', 'a', 'a', 'a', 'a', 'a', 'a']);
    metrics.stop();
  });

  test('decorates requests with CMCD request-mode keys from hls.js state', () => {
    const media = new FakeMedia();
    const hls = makeHls();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);
    metrics.setEngine(hls as any);

    const url = metrics.decorateUrl('http://h/hls/stream.m3u8?cachebust=abc', 'playlist');
    const cmcd = decodeURIComponent(new URL(url).searchParams.get('CMCD') as string);

    expect(cmcd).toContain('v=2');
    expect(cmcd).toContain('ot=m');
    expect(cmcd).toContain('sf=h');
    expect(cmcd).toContain('st=l');
    expect(cmcd.split(',')).toContain('su'); // startup until first playing event
    expect(cmcd).toContain('mtp=2600'); // 2,560 kbps rounded to 100
    expect(cmcd).toContain('br=1500');
    expect(cmcd).toMatch(/sid="[0-9a-f-]{36}"/);

    const segmentUrl = metrics.decorateUrl('http://h/hls/0/s-1.ts', 'segment');
    expect(decodeURIComponent(new URL(segmentUrl).searchParams.get('CMCD') as string)).toContain(
      'ot=av',
    );
    metrics.stop();
  });

  test('averages fragment download times into ttlb and reads live latency', async () => {
    const media = new FakeMedia();
    const hls = makeHls();
    hls.playingDate = new Date(Date.now() - 4_000);
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);
    metrics.setEngine(hls as any);
    expect(hls.on).toHaveBeenCalledWith('hlsFragLoaded', expect.any(Function));

    hls.emit('hlsFragLoaded', { frag: { stats: { loading: { start: 100, end: 300 } } } });
    hls.emit('hlsFragLoaded', { frag: { stats: { loading: { start: 400, end: 800 } } } });
    media.trigger('playing');
    await Promise.resolve();

    const [first] = reports();
    expect(first.ttlb).toBe(300);
    expect(first.ltc).toBeGreaterThanOrEqual(3_900);
    expect(first.ltc).toBeLessThan(5_000);

    metrics.setEngine(null);
    expect(hls.off).toHaveBeenCalledWith('hlsFragLoaded', expect.any(Function));
    metrics.stop();
  });

  test('reports w while stalled', async () => {
    const media = new FakeMedia();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);

    media.trigger('playing');
    media.trigger('waiting');
    await Promise.resolve();

    expect(reports().map(report => report.sta)).toEqual(['p', 'w']);
    expect(reports()[1].bs).toBe(true);

    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(reports()[2].sta).toBe('w');

    media.trigger('canplaythrough');
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(reports()[3].sta).toBe('p');
    metrics.stop();
  });

  test('su is only sent before playback starts', () => {
    const media = new FakeMedia();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);
    const decode = (url: string) =>
      decodeURIComponent(new URL(url).searchParams.get('CMCD') as string);

    expect(decode(metrics.decorateUrl('http://h/a.m3u8', 'playlist')).split(',')).toContain('su');
    media.trigger('playing');
    expect(decode(metrics.decorateUrl('http://h/a.m3u8', 'playlist')).split(',')).not.toContain(
      'su',
    );
    metrics.stop();
  });

  test('stop before attachMedia is safe', () => {
    const metrics = new PlaybackMetrics();
    expect(() => metrics.stop()).not.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('setEngine with the same instance binds once', () => {
    const hls = makeHls();
    const metrics = new PlaybackMetrics();
    metrics.setEngine(hls as any);
    metrics.setEngine(hls as any);
    expect(hls.on).toHaveBeenCalledTimes(1);
    metrics.stop();
  });

  test('ignores malformed fragment stats', async () => {
    const media = new FakeMedia();
    const hls = makeHls();
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);
    metrics.setEngine(hls as any);

    hls.emit('hlsFragLoaded', {});
    hls.emit('hlsFragLoaded', { frag: { stats: { loading: { start: 5, end: 5 } } } });
    media.trigger('playing');
    await Promise.resolve();

    expect(reports()[0].ttlb).toBeUndefined();
    metrics.stop();
  });

  test('survives a throwing hls getter', async () => {
    const media = new FakeMedia();
    const hls = makeHls();
    Object.defineProperty(hls, 'bandwidthEstimate', {
      get() {
        throw new Error('destroyed');
      },
    });
    const metrics = new PlaybackMetrics();
    metrics.attachMedia(media as unknown as HTMLVideoElement);
    metrics.setEngine(hls as any);

    media.trigger('playing');
    await Promise.resolve();

    const [first] = reports();
    expect(first.v).toBe(2);
    expect(first.sid).toMatch(/^[0-9a-f-]{36}$/);
    metrics.stop();
  });
});
