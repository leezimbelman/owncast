// Owncast variant playlists live at /hls/<variantIndex>/stream.m3u8.
const VARIANT_INDEX_PATTERN = /\/hls\/(\d+)\//;

export type RenditionLike = { id: string; height?: number; bitrate?: number };

// Label for a quality menu entry. The level URL carries the Owncast variant
// index, which selects the admin's name for that variant; without one, fall
// back to the height, then the bitrate, then the rendition id.
export function renditionLabel(
  rendition: RenditionLike,
  levelUrl: string | undefined,
  qualityNames: Map<number, string> | undefined,
): string {
  const match = levelUrl?.match(VARIANT_INDEX_PATTERN);
  const name = match ? qualityNames?.get(Number(match[1])) : undefined;
  if (name) {
    return name;
  }
  if (rendition.height) {
    return `${rendition.height}p`;
  }
  if (rendition.bitrate) {
    return `${Math.round(rendition.bitrate / 1000)} kbps`;
  }
  return rendition.id;
}
