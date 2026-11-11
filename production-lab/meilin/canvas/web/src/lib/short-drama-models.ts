import { modelOptionName, selectableModelsByCapability, type AiConfig } from "@/stores/use-config-store";

export function shortDramaMediaDefault(config: AiConfig, mode: "image" | "video") {
    const options = selectableModelsByCapability(config, mode);
    const preferred = options.find(option => mode === "image"
        ? /^gpt-image-2[.-]5(?:-|$)/i.test(modelOptionName(option))
        : /seedance-2[.-]5(?:-|$)/i.test(modelOptionName(option)));
    return preferred || (mode === "image" ? config.imageModel : config.videoModel) || options[0] || "";
}
