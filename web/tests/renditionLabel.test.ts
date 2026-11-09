import { renditionLabel } from '../components/video/player/renditionLabel';

describe('renditionLabel', () => {
  const names = new Map([
    [0, 'Low'],
    [1, 'High'],
  ]);
  const rendition = { id: '1', height: 720, bitrate: 2_500_000 };

  test('uses the admin name for the variant index in the level URL', () => {
    expect(renditionLabel(rendition, '/hls/1/stream.m3u8', names)).toBe('High');
  });

  test('falls back to the height when the variant has no admin name', () => {
    expect(renditionLabel(rendition, '/hls/7/stream.m3u8', names)).toBe('720p');
  });

  test('falls back to the height when the level URL has no variant index', () => {
    expect(renditionLabel(rendition, '/other/stream.m3u8', names)).toBe('720p');
    expect(renditionLabel(rendition, undefined, names)).toBe('720p');
  });

  test('falls back to the height when no names are loaded', () => {
    expect(renditionLabel(rendition, '/hls/1/stream.m3u8', undefined)).toBe('720p');
  });

  test('falls back to the bitrate in kbps without a height', () => {
    expect(renditionLabel({ id: '1', bitrate: 2_499_600 }, undefined, names)).toBe('2500 kbps');
  });

  test('falls back to the id without a height or bitrate', () => {
    expect(renditionLabel({ id: '3' }, undefined, names)).toBe('3');
  });
});
