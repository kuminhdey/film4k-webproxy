import Hls from 'hls.js';

// PNG signature: 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'
const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Strip fake PNG header from obfuscated MPEG-TS video chunks.
 * Checks for PNG magic bytes, parses until IEND chunk or finds
 * the MPEG-TS packet sync byte (0x47 / 71).
 */
export function stripPngHeader(buffer: ArrayBufferLike): ArrayBufferLike {
  if (!buffer || buffer.byteLength < PNG_SIG.length) {
    return buffer;
  }

  const bytes = new Uint8Array(buffer);
  let isPng = true;
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (bytes[i] !== PNG_SIG[i]) {
      isPng = false;
      break;
    }
  }

  // Not a PNG obfuscated chunk - return original buffer
  if (!isPng) {
    return buffer;
  }

  // First method: Standard PNG chunk parser searching for 'IEND' chunk
  const dataView = new DataView(buffer);
  let offset = PNG_SIG.length;

  while (offset + 12 <= bytes.length) {
    const chunkLength = dataView.getUint32(offset, false);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > bytes.length) {
      break;
    }

    // Check for 'IEND' chunk: 73, 69, 78, 68 ('I', 'E', 'N', 'D')
    if (
      bytes[offset + 4] === 73 &&
      bytes[offset + 5] === 69 &&
      bytes[offset + 6] === 78 &&
      bytes[offset + 7] === 68
    ) {
      // Clean video media payload starts right after IEND chunk.
      // chunkEnd is the exact end of the PNG stream (IEND chunk + 4-byte CRC).
      // Both fMP4 (ftyp, styp, moof, moov) and MPEG-TS (0x47) payloads begin immediately at chunkEnd.
      if (chunkEnd < bytes.length) {
        return buffer.slice(chunkEnd);
      }
    }
    offset = chunkEnd;
  }

  // Second method: Search for fMP4 box header (ftyp, styp, moof, moov) in first 512 bytes
  // if the fake PNG header lacks a standard IEND chunk structure.
  for (let i = PNG_SIG.length; i + 8 <= Math.min(bytes.length, 512); i++) {
    const t0 = bytes[i + 4];
    const t1 = bytes[i + 5];
    const t2 = bytes[i + 6];
    const t3 = bytes[i + 7];
    if (
      (t0 === 102 && t1 === 116 && t2 === 121 && t3 === 112) || // ftyp
      (t0 === 115 && t1 === 116 && t2 === 121 && t3 === 112) || // styp
      (t0 === 109 && t1 === 111 && t2 === 111 && t3 === 102) || // moof
      (t0 === 109 && t1 === 111 && t2 === 111 && t3 === 118)    // moov
    ) {
      return buffer.slice(i);
    }
  }

  // Third method: Search for MPEG-TS sync byte 0x47 (71)
  // If the stream server injects a fake PNG header without clean IEND chunk structure,
  // scan after the PNG signature for the first 0x47 sync byte that repeats with 188-byte TS packet spacing.
  for (let i = PNG_SIG.length; i < bytes.length; i++) {
    if (bytes[i] === 0x47) {
      // Verify MPEG-TS 188-byte packet boundary
      if (i + 188 < bytes.length && bytes[i + 188] === 0x47) {
        return buffer.slice(i);
      }
      if (i + 188 >= bytes.length) {
        return buffer.slice(i);
      }
    }
  }

  return buffer;
}

export function extractCleanBuffer(data: unknown): unknown {
  if (data instanceof ArrayBuffer) {
    return stripPngHeader(data);
  }
  if (ArrayBuffer.isView(data)) {
    const rawBuf = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    return stripPngHeader(rawBuf);
  }
  return data;
}

export type StatsCallback = (info: {
  mb: number;
  totalMb: number;
  sec: number;
  speedMbps: string;
  isCdn: boolean;
  type: string;
}) => void;

export function createFilm4kFragmentLoader(statsListener: StatsCallback | null = null) {
  let cumulativeBytesLoaded = 0;
  return class Film4kFragmentLoader extends Hls.DefaultConfig.loader {
  static reset(): void { cumulativeBytesLoaded = 0; }
  static bytesLoaded(): number { return cumulativeBytesLoaded; }
  constructor(config: any) {
    super(config);
    const originalLoad = this.load.bind(this);

    this.load = function (context: any, loaderConfig: any, callbacks: any) {
      const isCdn = Boolean(context.url && (context.url.includes('cdn') || context.url.startsWith('http')));
      const fragType = context.frag ? context.frag.type : 'frag';
      const startTime = performance.now();

      const customCallbacks = {
        ...callbacks,
        onSuccess: function (
          response: any,
          stats: any,
          ctx: any,
          networkDetails: any
        ) {
          if (response && response.data) {
            response.data = extractCleanBuffer(response.data);
          }

          const chunkBytes = response && response.data ? response.data.byteLength : 0;
          cumulativeBytesLoaded += chunkBytes;

          const mb = chunkBytes / (1024 * 1024);
          const totalMb = Number((cumulativeBytesLoaded / (1024 * 1024)).toFixed(1));

          // Calculate precise speed in Mbps
          const elapsedSec = Math.max(0.05, (performance.now() - startTime) / 1000);
          const rawSpeed = (chunkBytes * 8) / (elapsedSec * 1_000_000);
          const speedMbps = chunkBytes > 0 ? rawSpeed.toFixed(2) : '—';

          if (statsListener) {
            statsListener({
              mb,
              totalMb,
              sec: Number(elapsedSec.toFixed(2)),
              speedMbps,
              isCdn,
              type: fragType,
            });
          }

          callbacks.onSuccess(response, stats, ctx, networkDetails);
        },
        onError: function (
          err: any,
          ctx: any,
          networkDetails: any,
          stats: any
        ) {
          console.warn('[Film4kFragmentLoader] Chunk download error:', err);
          if (callbacks.onError) {
            callbacks.onError(err, ctx, networkDetails, stats);
          }
        },
      };

      originalLoad(context, loaderConfig, customCallbacks);
    };
  }
}
}
