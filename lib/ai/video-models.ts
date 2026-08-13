export type VideoModelSpec = {
  id: string;
  label: string;
  filterOff: boolean;
  speed: 'standard' | 'fast' | 'mini' | 'v2_5';
  resolutions: string[];
  minDuration: number;
  maxDuration: number;
  referenceTypes: Array<'image' | 'video' | 'audio'>;
  maxImageReferences: number;
  maxVideoReferences: number;
  maxAudioReferences: number;
  supportsAudioOnlyReference: boolean;
  supportsAudioGeneration: boolean;
  supportsAdaptiveDuration: boolean;
  requiresAdaptiveRatioForFrameMode: boolean;
};

export const VIDEO_MODELS: VideoModelSpec[] = [
  { id: 'doubao-seedance-2-0', label: 'Seedance 2.0', filterOff: false, speed: 'standard', resolutions: ['480p', '720p', '1080p', '4K'], minDuration: 4, maxDuration: 15, referenceTypes: ['image', 'video', 'audio'], maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, supportsAudioGeneration: true, supportsAdaptiveDuration: true, requiresAdaptiveRatioForFrameMode: false },
  { id: 'doubao-seedance-2-0-filter-off', label: 'Seedance 2.0 · FILTER OFF', filterOff: true, speed: 'standard', resolutions: ['480p', '720p', '1080p', '4K'], minDuration: 4, maxDuration: 15, referenceTypes: ['image', 'video', 'audio'], maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, supportsAudioGeneration: true, supportsAdaptiveDuration: true, requiresAdaptiveRatioForFrameMode: false },
  { id: 'doubao-seedance-2-0-fast', label: 'Seedance 2.0 Fast', filterOff: false, speed: 'fast', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 15, referenceTypes: ['image', 'video', 'audio'], maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, supportsAudioGeneration: true, supportsAdaptiveDuration: true, requiresAdaptiveRatioForFrameMode: false },
  { id: 'doubao-seedance-2-0-fast-filter-off', label: 'Seedance 2.0 Fast · FILTER OFF', filterOff: true, speed: 'fast', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 15, referenceTypes: ['image', 'video', 'audio'], maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, supportsAudioGeneration: true, supportsAdaptiveDuration: true, requiresAdaptiveRatioForFrameMode: false },
  { id: 'dreamina-seedance-2-0-mini', label: 'Seedance 2.0 Mini', filterOff: false, speed: 'mini', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 15, referenceTypes: ['image', 'video', 'audio'], maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, supportsAudioGeneration: true, supportsAdaptiveDuration: true, requiresAdaptiveRatioForFrameMode: false },
  { id: 'dreamina-seedance-2-0-mini-filter-off', label: 'Seedance 2.0 Mini · FILTER OFF', filterOff: true, speed: 'mini', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 15, referenceTypes: ['image', 'video', 'audio'], maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, supportsAudioGeneration: true, supportsAdaptiveDuration: true, requiresAdaptiveRatioForFrameMode: false },
  { id: 'dreamina-seedance-2-5', label: 'Seedance 2.5', filterOff: false, speed: 'v2_5', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 30, referenceTypes: ['image', 'video', 'audio'], maxImageReferences: 9, maxVideoReferences: 10, maxAudioReferences: 10, supportsAudioOnlyReference: true, supportsAudioGeneration: true, supportsAdaptiveDuration: true, requiresAdaptiveRatioForFrameMode: true },
  { id: 'dreamina-seedance-2-5-filter-off', label: 'Seedance 2.5 · FILTER OFF', filterOff: true, speed: 'v2_5', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 30, referenceTypes: ['image', 'video', 'audio'], maxImageReferences: 9, maxVideoReferences: 10, maxAudioReferences: 10, supportsAudioOnlyReference: true, supportsAudioGeneration: true, supportsAdaptiveDuration: true, requiresAdaptiveRatioForFrameMode: true },
];

export function getVideoModel(model: string) {
  return VIDEO_MODELS.find((item) => item.id === model);
}
