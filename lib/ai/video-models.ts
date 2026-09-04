export type VideoTransport = 'volcengine' | 'dashscope' | 'minimax-v2';
export type VideoImageRole = 'first_frame' | 'last_frame' | 'reference_image';

export type VideoModelSpec = {
  id: string;
  label: string;
  filterOff: boolean;
  speed: 'standard' | 'fast' | 'mini' | 'v2_5' | 'happyhorse' | 'h3';
  transport: VideoTransport;
  resolutions: string[];
  ratios: string[];
  minDuration: number;
  maxDuration: number;
  referenceTypes: Array<'image' | 'video' | 'audio'>;
  maxTotalReferences: number;
  minImageReferences: number;
  maxImageReferences: number;
  maxVideoReferences: number;
  maxAudioReferences: number;
  imageRoles: VideoImageRole[];
  supportsAudioOnlyReference: boolean;
  supportsAudioGeneration: boolean;
  supportsAdaptiveDuration: boolean;
  requiresAdaptiveRatioForFrameMode: boolean;
  requiresFixedRatioWithoutReferences: boolean;
  requiresPrompt: boolean;
};

export const VIDEO_MODEL_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '21:9', '9:21', 'adaptive'];
const SEEDANCE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'];
const HAPPYHORSE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '5:4', '21:9', '9:21'];
const ALL_IMAGE_ROLES: VideoImageRole[] = ['first_frame', 'last_frame', 'reference_image'];

const seedance = (overrides: Pick<VideoModelSpec, 'id' | 'label' | 'filterOff' | 'speed' | 'resolutions' | 'maxDuration' | 'maxVideoReferences' | 'maxAudioReferences' | 'supportsAudioOnlyReference' | 'requiresAdaptiveRatioForFrameMode'>): VideoModelSpec => ({
  ...overrides,
  transport: 'volcengine',
  ratios: SEEDANCE_RATIOS,
  minDuration: 4,
  referenceTypes: ['image', 'video', 'audio'],
  maxTotalReferences: 15,
  minImageReferences: 0,
  maxImageReferences: 9,
  imageRoles: ALL_IMAGE_ROLES,
  supportsAudioGeneration: true,
  supportsAdaptiveDuration: overrides.speed === 'v2_5',
  requiresFixedRatioWithoutReferences: false,
  requiresPrompt: false,
});

export const VIDEO_MODELS: VideoModelSpec[] = [
  seedance({ id: 'doubao-seedance-2-0', label: 'Seedance 2.0', filterOff: false, speed: 'standard', resolutions: ['480p', '720p', '1080p', '4K'], maxDuration: 15, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, requiresAdaptiveRatioForFrameMode: false }),
  seedance({ id: 'doubao-seedance-2-0-filter-off', label: 'Seedance 2.0 · FILTER OFF', filterOff: true, speed: 'standard', resolutions: ['480p', '720p', '1080p', '4K'], maxDuration: 15, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, requiresAdaptiveRatioForFrameMode: false }),
  seedance({ id: 'doubao-seedance-2-0-fast', label: 'Seedance 2.0 Fast', filterOff: false, speed: 'fast', resolutions: ['480p', '720p'], maxDuration: 15, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, requiresAdaptiveRatioForFrameMode: false }),
  seedance({ id: 'doubao-seedance-2-0-fast-filter-off', label: 'Seedance 2.0 Fast · FILTER OFF', filterOff: true, speed: 'fast', resolutions: ['480p', '720p'], maxDuration: 15, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, requiresAdaptiveRatioForFrameMode: false }),
  seedance({ id: 'dreamina-seedance-2-0-mini', label: 'Seedance 2.0 Mini', filterOff: false, speed: 'mini', resolutions: ['480p', '720p'], maxDuration: 15, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, requiresAdaptiveRatioForFrameMode: false }),
  seedance({ id: 'dreamina-seedance-2-0-mini-filter-off', label: 'Seedance 2.0 Mini · FILTER OFF', filterOff: true, speed: 'mini', resolutions: ['480p', '720p'], maxDuration: 15, maxVideoReferences: 3, maxAudioReferences: 3, supportsAudioOnlyReference: false, requiresAdaptiveRatioForFrameMode: false }),
  seedance({ id: 'dreamina-seedance-2-5', label: 'Seedance 2.5', filterOff: false, speed: 'v2_5', resolutions: ['480p', '720p'], maxDuration: 30, maxVideoReferences: 10, maxAudioReferences: 10, supportsAudioOnlyReference: true, requiresAdaptiveRatioForFrameMode: true }),
  seedance({ id: 'dreamina-seedance-2-5-filter-off', label: 'Seedance 2.5 · FILTER OFF', filterOff: true, speed: 'v2_5', resolutions: ['480p', '720p'], maxDuration: 30, maxVideoReferences: 10, maxAudioReferences: 10, supportsAudioOnlyReference: true, requiresAdaptiveRatioForFrameMode: true }),
  {
    id: 'happyhorse-1.1-i2v', label: 'HappyHorse 1.1 图生视频', filterOff: false, speed: 'happyhorse', transport: 'dashscope',
    resolutions: ['720p', '1080p'], ratios: ['adaptive'], minDuration: 3, maxDuration: 15,
    referenceTypes: ['image'], maxTotalReferences: 1, minImageReferences: 1, maxImageReferences: 1, maxVideoReferences: 0, maxAudioReferences: 0,
    imageRoles: ['first_frame'], supportsAudioOnlyReference: false, supportsAudioGeneration: false, supportsAdaptiveDuration: false,
    requiresAdaptiveRatioForFrameMode: true, requiresFixedRatioWithoutReferences: false, requiresPrompt: false,
  },
  {
    id: 'happyhorse-1.1-r2v', label: 'HappyHorse 1.1 参考图生视频', filterOff: false, speed: 'happyhorse', transport: 'dashscope',
    resolutions: ['720p', '1080p'], ratios: HAPPYHORSE_RATIOS, minDuration: 3, maxDuration: 15,
    referenceTypes: ['image'], maxTotalReferences: 9, minImageReferences: 1, maxImageReferences: 9, maxVideoReferences: 0, maxAudioReferences: 0,
    imageRoles: ['reference_image'], supportsAudioOnlyReference: false, supportsAudioGeneration: false, supportsAdaptiveDuration: false,
    requiresAdaptiveRatioForFrameMode: false, requiresFixedRatioWithoutReferences: false, requiresPrompt: false,
  },
  {
    id: 'happyhorse-1.1-t2v', label: 'HappyHorse 1.1 文生视频', filterOff: false, speed: 'happyhorse', transport: 'dashscope',
    resolutions: ['720p', '1080p'], ratios: HAPPYHORSE_RATIOS, minDuration: 3, maxDuration: 15,
    referenceTypes: [], maxTotalReferences: 0, minImageReferences: 0, maxImageReferences: 0, maxVideoReferences: 0, maxAudioReferences: 0,
    imageRoles: [], supportsAudioOnlyReference: false, supportsAudioGeneration: false, supportsAdaptiveDuration: false,
    requiresAdaptiveRatioForFrameMode: false, requiresFixedRatioWithoutReferences: true, requiresPrompt: true,
  },
  {
    id: 'MiniMax-H3', label: 'MiniMax H3', filterOff: false, speed: 'h3', transport: 'minimax-v2',
    resolutions: ['768p', '2K'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], minDuration: 4, maxDuration: 15,
    referenceTypes: ['image', 'video', 'audio'], maxTotalReferences: 12, minImageReferences: 0, maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3,
    imageRoles: ALL_IMAGE_ROLES, supportsAudioOnlyReference: false, supportsAudioGeneration: false, supportsAdaptiveDuration: false,
    requiresAdaptiveRatioForFrameMode: true, requiresFixedRatioWithoutReferences: true, requiresPrompt: true,
  },
];

export function getVideoModel(model: string) {
  return VIDEO_MODELS.find((item) => item.id === model);
}
