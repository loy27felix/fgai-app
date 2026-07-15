import type { UsageMeasurements, UsagePriceSnapshot } from './types';

const SCALE = 10_000_000_000n;
const MILLION = 1_000_000n;

function decimal(value?: string): bigint {
  if (!value) return 0n;
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`Invalid USD decimal: ${value}`);
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt((fraction + '0000000000').slice(0, 10));
}

function format(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / SCALE}.${(absolute % SCALE).toString().padStart(10, '0')}`;
}

function nonNegativeInteger(value: number | undefined, label: string): bigint {
  const normalized = value ?? 0;
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return BigInt(normalized);
}

export function calculateEstimatedCost(
  measurements: UsageMeasurements,
  price: UsagePriceSnapshot,
): string {
  const videoMilliseconds = Math.round((measurements.videoSeconds ?? 0) * 1000);
  if (!Number.isSafeInteger(videoMilliseconds) || videoMilliseconds < 0) {
    throw new Error('videoSeconds must be non-negative');
  }

  let scaled = 0n;
  scaled += nonNegativeInteger(measurements.inputTokens, 'inputTokens')
    * decimal(price.inputTokenUsdPerMillion) / MILLION;
  scaled += nonNegativeInteger(measurements.outputTokens, 'outputTokens')
    * decimal(price.outputTokenUsdPerMillion) / MILLION;
  scaled += nonNegativeInteger(measurements.imageCount, 'imageCount')
    * decimal(price.imageUsdEach);
  scaled += BigInt(videoMilliseconds) * decimal(price.videoUsdPerSecond) / 1000n;
  return format(scaled);
}
