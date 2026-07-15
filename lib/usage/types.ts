export type CostSource = 'reported' | 'estimated' | 'unknown';

export type UsageMeasurements = {
  inputTokens?: number;
  outputTokens?: number;
  imageCount?: number;
  videoSeconds?: number;
};

export type UsagePriceSnapshot = {
  currency: 'USD';
  inputTokenUsdPerMillion?: string;
  outputTokenUsdPerMillion?: string;
  imageUsdEach?: string;
  videoUsdPerSecond?: string;
  capturedAt?: string;
};
