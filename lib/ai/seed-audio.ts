export const SEED_AUDIO_MODEL = "seed-audio-1.0";
export const SEED_AUDIO_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/create";

export type SeedAudioFormat = "mp3" | "wav" | "pcm" | "ogg_opus";

/**
 * Seed Audio accepts a smaller format set than the generic OpenAI-compatible
 * audio settings exposed by the canvas. Keep the UI values stable and map
 * them to the provider contract at the boundary.
 */
export function normalizeSeedAudioFormat(value: string): SeedAudioFormat {
  const normalized = value.trim().toLowerCase();
  if (normalized === "wav") return "wav";
  if (normalized === "pcm") return "pcm";
  if (normalized === "opus" || normalized === "ogg_opus") return "ogg_opus";
  return "mp3";
}

export function seedAudioMimeType(format: SeedAudioFormat) {
  if (format === "wav") return "audio/wav";
  if (format === "pcm") return "audio/pcm";
  if (format === "ogg_opus") return "audio/ogg";
  return "audio/mpeg";
}

export function buildSeedAudioRequest(input: { prompt: string; instructions?: string; format?: string }) {
  const prompt = input.prompt.trim();
  const instructions = input.instructions?.trim() || "";
  const textPrompt = instructions ? `${prompt}\n\n声音指令：${instructions}` : prompt;
  return {
    model: SEED_AUDIO_MODEL,
    text_prompt: textPrompt,
    audio_config: {
      format: normalizeSeedAudioFormat(input.format || "mp3"),
      sample_rate: 48_000,
      pitch_rate: 0,
      speech_rate: 0,
      loudness_rate: 0,
    },
    watermark: {},
  };
}

export function isSeedAudioModel(value: string) {
  return value.trim().toLowerCase() === SEED_AUDIO_MODEL;
}
