const URL_CMCD_COLLECTOR = `/api/metrics/cmcd`;
const EVENT_REPORT_INTERVAL = 10000;
const MAX_VALID_LATENCY_SECONDS = 100; // Anything > this gets thrown out.
const CMCD_VERSION = 2;

function generateSessionID() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // randomUUID is only exposed in secure contexts; build a v4 UUID from
  // getRandomValues, which is available everywhere.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // eslint-disable-next-line no-bitwise
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // eslint-disable-next-line no-bitwise
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// CMCD keys whose values are tokens, which the spec serializes unquoted
// (ot=v), unlike string values which are quoted (sid="...").
const CMCD_TOKEN_KEYS = new Set(['ot', 'sf', 'st', 'sta', 'e']);

// Serializes CMCD keys as a CMCD dictionary payload: alphabetized,
// booleans as bare keys when true, tokens bare, strings quoted with
// escaping.
function encodeCmcdDictionary(keys) {
  return Object.keys(keys)
    .filter(key => keys[key] !== undefined && keys[key] !== null && keys[key] !== false)
    .sort()
    .map(key => {
      const value = keys[key];
      if (value === true) {
        return key;
      }
      if (typeof value === 'string' && !CMCD_TOKEN_KEYS.has(key)) {
        return `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      }
      return `${key}=${value}`;
    })
    .join(',');
}

function appendCmcdQuery(uri, keys) {
  const payload = encodeCmcdDictionary(keys);
  if (!payload) {
    return uri;
  }
  const separator = uri.includes('?') ? '&' : '?';
  return `${uri}${separator}CMCD=${encodeURIComponent(payload)}`;
}

// hls.js event name for Hls.Events.FRAG_LOADED. Spelled out so this module
// stays free of the ESM-only @videojs packages and remains unit-testable.
const HLS_FRAG_LOADED_EVENT = 'hlsFragLoaded';

/*
CMCD v2 (CTA-5004-A) metrics emitter.

Request mode: every playlist and segment request the player makes is
decorated with a CMCD query parameter carrying throughput, buffer, bitrate
and live latency data, which the server harvests off the requests it is
already serving. The hls.js xhrSetup hook (see player/hlsConfig.ts) calls
decorateUrl for each request.

Event mode: player state transitions, errors and a periodic time-interval
report are POSTed to the CMCD collector endpoint.

Lifecycle: construct once per player mount, attachMedia(videoElement) when
the element exists, setEngine(hls) every time the hls.js engine is created
(it is rebuilt when the latency profile changes), stop() on unmount.
*/
class PlaybackMetrics {
  constructor() {
    this.media = null;
    this.hls = null;
    this.clockSkewMs = 0;
    this.sessionID = generateSessionID();
    this.sequenceNumber = 0;

    this.hasStartedPlaying = false;
    this.isStalled = false;
    this.playRequestedAt = null;
    this.mediaStartDelayMs = null;
    this.mediaStartDelaySent = false;
    this.segmentDownloadTimesMs = [];

    this.handlePlay = this.handlePlay.bind(this);
    this.handlePlaying = this.handlePlaying.bind(this);
    this.handlePause = this.handlePause.bind(this);
    this.handleEnded = this.handleEnded.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleBuffering = this.handleBuffering.bind(this);
    this.handleNoLongerBuffering = this.handleNoLongerBuffering.bind(this);
    this.handleFragLoaded = this.handleFragLoaded.bind(this);

    this.mediaListeners = [
      ['play', this.handlePlay],
      ['playing', this.handlePlaying],
      ['pause', this.handlePause],
      ['ended', this.handleEnded],
      ['error', this.handleError],
      ['stalled', this.handleBuffering],
      ['waiting', this.handleBuffering],
      ['canplaythrough', this.handleNoLongerBuffering],
    ];

    this.eventReportTimer = setInterval(() => {
      if (!this.media || !this.hasStartedPlaying) {
        return;
      }
      if (this.media.paused) {
        // Viewer pings keep a paused tab active. Refresh its CMCD state too,
        // or the server prunes its health before the viewer.
        this.sendEventReport('t', { sta: 'a' });
        return;
      }
      this.sendEventReport('t');
    }, EVENT_REPORT_INTERVAL);
  }

  attachMedia(media) {
    if (this.media === media) {
      return;
    }
    this.detachMedia();
    this.media = media;
    if (media) {
      this.mediaListeners.forEach(([event, handler]) => media.addEventListener(event, handler));
    }
  }

  detachMedia() {
    if (!this.media) {
      return;
    }
    this.mediaListeners.forEach(([event, handler]) =>
      this.media.removeEventListener(event, handler),
    );
    this.media = null;
  }

  // Bind to the hls.js instance for throughput, bitrate, latency and
  // per-fragment download timing. Pass null when the engine is destroyed.
  setEngine(hls) {
    if (this.hls === hls) {
      return;
    }
    if (this.hls) {
      this.hls.off(HLS_FRAG_LOADED_EVENT, this.handleFragLoaded);
    }
    this.hls = hls;
    if (hls) {
      hls.on(HLS_FRAG_LOADED_EVENT, this.handleFragLoaded);
    }
  }

  stop() {
    clearInterval(this.eventReportTimer);
    // Component teardown does not reliably emit an ended event. Preserve the
    // terminal state while its viewer is still active.
    if (this.hasStartedPlaying && this.media && !this.media.ended) {
      this.sendEventReport('ps', { sta: 'e' });
    }
    this.detachMedia();
    this.setEngine(null);
  }

  // Keep our client clock in sync with the server clock to determine
  // accurate latency calculations.
  setClockSkew(skewMs) {
    this.clockSkewMs = skewMs;
  }

  // RequestDecorator implementation used by the hls.js xhrSetup hook.
  decorateUrl(url, kind) {
    return appendCmcdQuery(url, {
      ...this.commonCmcdKeys(),
      ot: kind === 'segment' ? 'av' : 'm',
      sf: 'h',
      st: 'l',
      su: !this.hasStartedPlaying || undefined,
    });
  }

  // Time segment downloads client-side: reported as ttlb, the only
  // download duration measurement that stays honest when a proxy or
  // tunnel sits between the viewer and the server.
  handleFragLoaded(_event, data) {
    const loading = data?.frag?.stats?.loading;
    if (!loading || !(loading.end > loading.start)) {
      return;
    }
    this.segmentDownloadTimesMs.push(Math.round(loading.end - loading.start));
  }

  handlePlay() {
    if (this.playRequestedAt === null) {
      this.playRequestedAt = Date.now();
    }
  }

  handlePlaying() {
    if (this.mediaStartDelayMs === null && this.playRequestedAt !== null) {
      this.mediaStartDelayMs = Date.now() - this.playRequestedAt;
    }
    const firstPlay = !this.hasStartedPlaying;
    this.hasStartedPlaying = true;
    this.isStalled = false;
    if (firstPlay) {
      this.sendEventReport('ps', { sta: 'p' });
    }
  }

  handlePause() {
    // Tearing down the player fires a pause; don't report it.
    if (this.media && !this.media.ended) {
      this.sendEventReport('ps', { sta: 'a' });
    }
  }

  handleEnded() {
    this.sendEventReport('ps', { sta: 'e' });
  }

  handleError() {
    const error = this.media?.error;
    this.sendEventReport('e', { ec: error ? String(error.code) : undefined });
  }

  handleBuffering() {
    // Buffering before the first frame is startup, not an interruption. A
    // waiting event that fires while seeking is the fetch at a seek
    // discontinuity, not a playback interruption. Genuine starvation fires
    // with seeking false, so only report those.
    if (!this.hasStartedPlaying || this.media?.seeking || this.isStalled) {
      return;
    }
    this.isStalled = true;
    this.sendEventReport('ps', { sta: 'w', bs: true });
  }

  handleNoLongerBuffering() {
    this.isStalled = false;
  }

  // CMCD keys shared by request-mode decoration and event reports.
  commonCmcdKeys() {
    const keys = {
      v: CMCD_VERSION,
      sid: this.sessionID,
    };

    // hls.js getters can throw on a destroyed instance; keep whatever was
    // collected so far.
    try {
      const throughput = this.measuredThroughputKbps();
      if (throughput) {
        keys.mtp = throughput;
      }

      const bitrate = this.currentBitrateKbps();
      if (bitrate) {
        keys.br = bitrate;
      }

      const buffer = this.bufferLengthMs();
      if (buffer !== null) {
        keys.bl = buffer;
      }

      const latency = this.liveLatencyMs();
      if (latency !== null) {
        keys.ltc = latency;
      }

      const playbackRate = this.media?.playbackRate ?? 1;
      if (playbackRate !== 1) {
        keys.pr = playbackRate;
      }
    } catch {
      // Ignore; base keys are still reported.
    }

    return keys;
  }

  async sendEventReport(event, extraKeys = {}) {
    this.sequenceNumber += 1;

    const report = {
      ...this.commonCmcdKeys(),
      ...extraKeys,
      e: event,
      ts: Date.now(),
      sn: this.sequenceNumber,
    };

    if (report.sta === undefined) {
      report.sta = this.playerStateToken();
    }

    if (!this.mediaStartDelaySent && this.mediaStartDelayMs !== null) {
      this.mediaStartDelaySent = true;
      report.msd = this.mediaStartDelayMs;
    }

    const droppedFrames = this.droppedFrameCount();
    if (droppedFrames) {
      report.df = droppedFrames;
    }

    // Average client-measured segment download time since the last report,
    // reported as ttlb in milliseconds.
    if (this.segmentDownloadTimesMs.length > 0) {
      const sum = this.segmentDownloadTimesMs.reduce((p, c) => p + c, 0);
      report.ttlb = Math.round(sum / this.segmentDownloadTimesMs.length);
      this.segmentDownloadTimesMs = [];
    }

    Object.keys(report).forEach(key => {
      if (report[key] === undefined || report[key] === null) {
        delete report[key];
      }
    });

    try {
      await fetch(URL_CMCD_COLLECTOR, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(report),
      });
    } catch (e) {
      console.error(e);
    }
  }

  playerStateToken() {
    if (this.media?.seeking) {
      return 'k';
    }
    if (this.media?.ended) {
      return 'e';
    }
    if (this.media?.paused) {
      return 'a';
    }
    if (this.isStalled) {
      return 'w';
    }
    return 'p';
  }

  // hls.js bandwidth estimate in bits per second, reported as kbps rounded
  // to the nearest 100 as the CMCD spec asks.
  measuredThroughputKbps() {
    const bandwidth = this.hls?.bandwidthEstimate;
    if (!bandwidth || !Number.isFinite(bandwidth)) {
      return null;
    }
    return Math.round(bandwidth / 1000 / 100) * 100;
  }

  currentBitrateKbps() {
    const level = this.hls?.levels?.[this.hls.currentLevel];
    const bitrate = level?.bitrate;
    if (!bitrate) {
      return null;
    }
    return Math.round(bitrate / 1000);
  }

  bufferLengthMs() {
    try {
      const buffered = this.media?.buffered;
      if (!buffered || buffered.length === 0) {
        return null;
      }
      const bufferMs = (buffered.end(buffered.length - 1) - this.media.currentTime) * 1000;
      if (bufferMs < 0) {
        return null;
      }
      // The spec asks for buffer length rounded to the nearest 100ms.
      return Math.round(bufferMs / 100) * 100;
    } catch {
      return null;
    }
  }

  // Wall-clock latency: program-date-time of the playing position (hls.js
  // playingDate) against the server clock.
  liveLatencyMs() {
    try {
      const playingDate = this.hls?.playingDate;
      if (!playingDate) {
        return null;
      }
      const now = Date.now() + this.clockSkewMs;
      const latency = now - playingDate.getTime();

      // Throw away values that seem invalid.
      if (latency < 0 || latency / 1000 >= MAX_VALID_LATENCY_SECONDS) {
        return null;
      }
      return Math.round(latency);
    } catch {
      return null;
    }
  }

  droppedFrameCount() {
    const media = this.media;
    if (!media?.getVideoPlaybackQuality) {
      return null;
    }
    return media.getVideoPlaybackQuality().droppedVideoFrames || null;
  }
}

export default PlaybackMetrics;
