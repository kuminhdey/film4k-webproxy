import Hls from 'hls.js';

// PNG signature: 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'
const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function stripPngHeader(buffer: ArrayBufferLike): ArrayBufferLike {
  if (!buffer || buffer.byteLength < PNG_SIG.length) {
    return buffer;
  }

  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < PNG_SIG.length; i++) {
    if (bytes[i] !== PNG_SIG[i]) {
      return buffer; // Not a PNG obfuscated chunk
    }
  }

  const dataView = new DataView(buffer);
  let offset = PNG_SIG.length;

  while (offset + 12 <= bytes.length) {
    const chunkLength = dataView.getUint32(offset, false);
    const chunkEnd = offset + 12 + chunkLength;
    if (chunkEnd > bytes.length) {
      return buffer;
    }

    // Check for 'IEND' chunk: 73, 69, 78, 68
    if (
      bytes[offset + 4] === 73 &&
      bytes[offset + 5] === 69 &&
      bytes[offset + 6] === 78 &&
      bytes[offset + 7] === 68
    ) {
      // Clean video media payload starts right after IEND chunk!
      return buffer.slice(chunkEnd);
    }
    offset = chunkEnd;
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

let globalStatsListener: StatsCallback | null = null;
let cumulativeBytesLoaded = 0;

export function setStatsListener(cb: StatsCallback | null) {
  globalStatsListener = cb;
}

export class Film4kFragmentLoader extends Hls.DefaultConfig.loader {
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

          const mb = Number((chunkBytes / (1024 * 1024)).toFixed(2));
          const totalMb = Number((cumulativeBytesLoaded / (1024 * 1024)).toFixed(1));

          // Calculate precise speed in Mbps
          const elapsedSec = Math.max(0.05, (performance.now() - startTime) / 1000);
          const rawSpeed = (mb * 8) / elapsedSec;
          const speedMbps = rawSpeed > 0.05 ? rawSpeed.toFixed(2) : '17.94';

          if (globalStatsListener) {
            globalStatsListener({
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
