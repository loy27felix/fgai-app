export const DEFAULT_USD_TO_CNY = 6.77;

function parsedRate(value: string | undefined) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * Exchange rate used for display only. Keep the source in an environment
 * variable so the owner can update it without changing provider prices.
 */
export function getUsdToCnyRate() {
  return parsedRate(process.env.USAGE_USD_TO_CNY_RATE) || DEFAULT_USD_TO_CNY;
}

export function usdToCny(usd: number, rate = getUsdToCnyRate()) {
  return Number((usd * rate).toFixed(6));
}

export function fxSnapshot(rate = getUsdToCnyRate()) {
  return {
    from: 'USD',
    to: 'CNY',
    rate,
    source: process.env.USAGE_USD_TO_CNY_RATE ? 'USAGE_USD_TO_CNY_RATE' : 'fallback_config',
  } as const;
}
