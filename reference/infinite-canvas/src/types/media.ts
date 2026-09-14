export type ReferenceVideo = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    cloudStoragePath?: string;
    cloudAssetId?: string;
    bytes?: number;
    width?: number;
    height?: number;
    durationMs?: number;
};

export type ReferenceAudio = {
    id: string;
    name: string;
    type: string;
    url: string;
    storageKey?: string;
    cloudStoragePath?: string;
    cloudAssetId?: string;
    durationMs?: number;
};
