export type VideoModelSpec = {
  id: string;
  label: string;
  filterOff: boolean;
  speed: 'standard' | 'fast' | 'mini';
  resolutions: string[];
};

export const VIDEO_MODELS: VideoModelSpec[] = [
  { id: 'doubao-seedance-2-0', label: 'Seedance 2.0', filterOff: false, speed: 'standard', resolutions: ['480p', '720p', '1080p', '4K'] },
  { id: 'doubao-seedance-2-0-filter-off', label: 'Seedance 2.0 · FILTER OFF', filterOff: true, speed: 'standard', resolutions: ['480p', '720p', '1080p', '4K'] },
  { id: 'doubao-seedance-2-0-fast', label: 'Seedance 2.0 Fast', filterOff: false, speed: 'fast', resolutions: ['480p', '720p'] },
  { id: 'doubao-seedance-2-0-fast-filter-off', label: 'Seedance 2.0 Fast · FILTER OFF', filterOff: true, speed: 'fast', resolutions: ['480p', '720p'] },
  { id: 'dreamina-seedance-2-0-mini', label: 'Seedance 2.0 Mini', filterOff: false, speed: 'mini', resolutions: ['480p', '720p'] },
  { id: 'dreamina-seedance-2-0-mini-filter-off', label: 'Seedance 2.0 Mini · FILTER OFF', filterOff: true, speed: 'mini', resolutions: ['480p', '720p'] },
];

export function getVideoModel(model: string) {
  return VIDEO_MODELS.find((item) => item.id === model);
}
