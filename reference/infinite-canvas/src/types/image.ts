export type ReferenceImage = {
    id: string;
    name: string;
    type: string;
    dataUrl: string;
    url?: string;
    storageKey?: string;
    /** Private creator-assets object; the only durable owner for new references. */
    cloudStoragePath?: string;
    cloudAssetId?: string;
};
