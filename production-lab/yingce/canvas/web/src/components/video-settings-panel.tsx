import { type ReactNode } from "react";
import { Slider } from "antd";
import { Switch } from "@/components/ui/base/switch";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceFastModel, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution } from "@/lib/seedance-video";
import { isVolcengineArkVideoProtocol } from "@/lib/model-protocols";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { formatVideoResolutionLabel, isVideoResolutionMatch, normalizeVideoDuration, videoDimensionsForRatioAndResolution, videoResolutionComparisonKey } from "@/lib/video-generation-options";
import { modelCapabilityConfigFor, resolveVideoRatioValue, resolveVideoResolutionValue, videoDurationOptions, type VideoCapabilityConfig } from "@/lib/model-capabilities";
import { modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoArkPrivateAssetUpload", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[292px] space-y-3" }: VideoSettingsPanelProps) {
    const profile = modelCapabilityConfigFor(config, config.model).video!;
	const priceTiers = modelPriceTiers(config);
    if (resolveModelRequestConfig(config, config.model).interfaceType === "volcengine-jimeng-video") {
		return <JiMengVideoSettingsPanel config={config} profile={profile} priceTiers={priceTiers} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (isSeedanceVideoConfig(config)) {
		return <SeedanceVideoSettingsPanel config={config} profile={profile} priceTiers={priceTiers} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const seconds = normalizeVideoDuration(config.videoSeconds);
    const resolution = resolveVideoResolutionValue(profile, config.vquality);
    const ratio = resolveVideoRatioValue(profile, config.size);
    const dimensions = videoDimensionsForRatioAndResolution(ratio, resolution);
    const sizeSupported = profile.ratios.length > 0;
    const configuredResolutions = profile.resolutions.map((value) => ({ value, label: formatVideoResolutionLabel(value) }));
    const generateAudio = boolConfig(config.videoGenerateAudio, profile.generateAudio.default);
    const watermark = boolConfig(config.videoWatermark, profile.watermark.default);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                {sizeSupported ? <RatioCards values={profile.ratios} value={ratio} theme={theme} onChange={(value) => onConfigChange("size", value)} /> : null}
                {configuredResolutions.length ? <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2">
                        {configuredResolutions.map((item) => (
							<OptionPill key={item.value} selected={isVideoResolutionMatch(resolution, item.value)} disabled={!hasPriceTierForVideoSelection(priceTiers, item.value, Number(seconds))} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup> : null}
                {dimensions ? <div className="text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.muted }}>输出尺寸 {dimensions.width} × {dimensions.height}</div> : null}
                <SettingGroup title="视频时长" color={theme.node.muted}>
					<VideoDurationControl profile={profile} value={Number(seconds)} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, resolution, value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                {profile.generateAudio.supported ? <AudioControl checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                {profile.watermark.supported ? <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}
            </div>
        </ImageSettingsTheme>
    );
}

function JiMengVideoSettingsPanel({ config, profile, priceTiers, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { profile: VideoCapabilityConfig; priceTiers: ReturnType<typeof modelPriceTiers> }) {
    const seconds = normalizeVideoDuration(config.videoSeconds);
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <RatioCards values={profile.ratios} value={config.size} theme={theme} onChange={(value) => onConfigChange("size", value)} />
                <SettingGroup title="视频时长" color={theme.node.muted}>
					<VideoDurationControl profile={profile} value={Number(seconds)} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, "*", value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, profile, priceTiers, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { profile: VideoCapabilityConfig; priceTiers: ReturnType<typeof modelPriceTiers> }) {
    const model = modelOptionName(config.model || config.videoModel);
    const resolution = normalizeSeedanceResolution(config.vquality, model);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, profile.generateAudio.default);
    const watermark = boolConfig(config.videoWatermark, profile.watermark.default);
    const useArkPrivateAssets = boolConfig(config.videoArkPrivateAssetUpload, true);
    const isArkSeedance = isVolcengineArkVideoProtocol(resolveModelRequestConfig(config, config.model).interfaceType);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-sm font-semibold">视频设置</div> : null}
                <RatioCards values={profile.ratios} value={ratio} theme={theme} onChange={(value) => onConfigChange("size", value)} />
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2">
                        {profile.resolutions.map((value) => {
                            const item = { value, label: value.toUpperCase() };
							const disabled = (item.value === "1080p" && isSeedanceFastModel(model)) || !hasPriceTierForVideoSelection(priceTiers, item.value, duration);
                            return (
                                <OptionPill key={item.value} selected={resolution === item.value} disabled={disabled} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            );
                        })}
                    </div>
                    {isSeedanceFastModel(model) ? <div className="text-[var(--fs-tiny)] leading-4 opacity-55">fast 模型自动使用 720P</div> : null}
                </SettingGroup>
                <SettingGroup title="视频时长" color={theme.node.muted}>
					<VideoDurationControl profile={profile} value={duration} theme={theme} disabled={(value) => !hasPriceTierForVideoSelection(priceTiers, resolution, value)} onChange={(value) => onConfigChange("videoSeconds", String(value))} />
                </SettingGroup>
                {profile.generateAudio.supported ? <AudioControl checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} /> : null}
                {profile.watermark.supported ? <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} /> : null}
                {isArkSeedance ? (
                    <SettingGroup title="参考图" color={theme.node.muted}>
                        <div className="rounded-md px-2" style={{ background: theme.toolbar.itemHover }}>
                            <SwitchRow label="自动同步可信素材（确认拥有使用权）" checked={useArkPrivateAssets} theme={theme} onChange={(checked) => onConfigChange("videoArkPrivateAssetUpload", String(checked))} />
                        </div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return formatVideoResolutionLabel(value);
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    // The compact summary must mirror the selected value (for example 16:9),
    // while the settings panel can still use semantic labels such as 横屏.
    if (ratio === value) return ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string) {
    return `${normalizeVideoDuration(value)}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

function OptionPill({ selected, disabled = false, label, theme, onClick, children }: { selected: boolean; disabled?: boolean; label?: string; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} aria-label={label} aria-pressed={selected} className="h-8 cursor-pointer whitespace-nowrap rounded-lg border px-1 text-[var(--fs-label)] font-medium leading-none transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: selected ? theme.toolbar.activeBg : "transparent", borderColor: selected ? theme.node.text : theme.toolbar.border, color: selected ? theme.node.text : theme.node.muted, outlineColor: theme.node.muted }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="text-[var(--fs-tiny)] font-semibold" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function DurationInput({ value, min, max, theme, normalize, onChange }: { value: number; min: number; max?: number; theme: CanvasTheme; normalize: (value: number) => number; onChange: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = normalize(Math.min(max || Number.POSITIVE_INFINITY, Math.max(min, Math.floor(Number(input.value) || value || min))));
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-8 w-20 shrink-0 items-center overflow-hidden rounded-md border text-[var(--fs-label)]" style={{ background: theme.toolbar.itemHover, borderColor: theme.toolbar.border, color: theme.node.text }}>
            <input
                key={`${min}-${value}`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                defaultValue={value}
                aria-label="视频秒数"
                className="min-w-0 flex-1 bg-transparent pl-2 text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="shrink-0 px-1.5" style={{ color: theme.node.muted }}>秒</span>
        </label>
    );
}

function VideoDurationControl({ profile, value, theme, disabled, onChange }: { profile: VideoCapabilityConfig; value: number; theme: CanvasTheme; disabled?: (value: number) => boolean; onChange: (value: number) => void }) {
    const options = [...new Set(videoDurationOptions(profile))].filter((option) => option > 0 && !disabled?.(option)).sort((left, right) => left - right);
    if (options.length > 4 || (profile.duration.selection === "range" && options.length > 1)) {
        return <DurationRangeControl value={value} options={options} theme={theme} onChange={onChange} />;
    }
    if (!options.length) return <div className="text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>所选清晰度暂无可用时长</div>;
    return <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(options.length, 4)}, minmax(0, 1fr))` }}>
		{options.map((option) => <OptionPill key={option} selected={normalizedNumber(value) === option} disabled={disabled?.(option)} theme={theme} onClick={() => onChange(option)}>{option}s</OptionPill>)}
    </div>;
}

function modelPriceTiers(config: AiConfig) {
	const channel = resolveModelChannel(config, config.model);
	const cost = channel.modelCosts?.find((item) => item.model === modelOptionName(config.model));
	return cost?.logicalPriceTiers || [];
}

function hasPriceTierForVideoSelection(tiers: ReturnType<typeof modelPriceTiers>, resolution: string, seconds: number) {
	if (!tiers.length) return true;
	const normalizedResolution = normalizeTierResolution(resolution);
	return tiers.some((tier) => {
		const selector = tier.selector || {};
		const tierResolution = selector.vquality || tier.resolution;
		const tierSeconds = selector.videoSeconds ? Number(selector.videoSeconds) : tier.videoSeconds;
		return (tierResolution === "*" || !tierResolution || normalizeTierResolution(tierResolution) === normalizedResolution) && (!tierSeconds || tierSeconds === seconds);
	});
}

function normalizeTierResolution(value: string) {
	return videoResolutionComparisonKey(value);
}

function DurationRangeControl({ value, options, theme, onChange }: { value: number; options: number[]; theme: CanvasTheme; onChange: (value: number) => void }) {
    const min = options[0]!;
    const max = options[options.length - 1]!;
    const interval = options[1]! - min;
    const regular = options.every((option, index) => option === min + index * interval);
    const normalize = (candidate: number) => options.reduce((nearest, option) => Math.abs(option - candidate) < Math.abs(nearest - candidate) ? option : nearest, min);
    const normalized = normalize(Number.isFinite(value) ? value : min);
    const marks = regular ? undefined : Object.fromEntries(options.map((option) => [option, { label: null }]));
    return <div className="space-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
            <Slider
                min={min}
                max={max}
                step={regular ? interval : null}
                marks={marks}
                value={normalized}
                ariaLabelForHandle="视频时长（秒）"
                tooltip={{ formatter: (seconds) => `${seconds} 秒` }}
                className="!mx-1 !my-3 min-w-0 flex-1"
                onChange={(next) => onChange(normalize(next))}
            />
            <DurationInput value={normalized} min={min} max={max} theme={theme} normalize={normalize} onChange={onChange} />
        </div>
        <div className="flex justify-between px-0.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
            <span>{min}s</span>
            <span>{max}s</span>
        </div>
    </div>;
}

function normalizedNumber(value: number) {
    return Number.isFinite(value) ? Math.floor(value) : 0;
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(7, Math.round((width / longSide) * 16));
    const previewHeight = Math.max(7, Math.round((height / longSide) * 16));
    return <span className="shrink-0 rounded-[2px] border" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function RatioCards({ values, value, theme, onChange }: { values: string[]; value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    const order = ["adaptive", "auto", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
    const sorted = [...values].sort((left, right) => (order.indexOf(left) < 0 ? order.length : order.indexOf(left)) - (order.indexOf(right) < 0 ? order.length : order.indexOf(right)));
    return <SettingGroup title="比例" color={theme.node.muted}>
        <div className="grid grid-cols-5 gap-2">
            {sorted.map((option) => {
                const automatic = option === "adaptive" || option === "auto";
                const selected = value === option;
                const preview = automatic ? { width: 16, height: 9 } : ratioPreview(option);
                return <button key={option} type="button" aria-label={`视频比例 ${option}`} aria-pressed={selected}
                    className="flex h-16 min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border px-1 text-[var(--fs-tiny)] leading-none transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                    style={{ background: selected ? theme.toolbar.activeBg : "transparent", borderColor: selected ? theme.node.text : theme.toolbar.border, color: selected ? theme.node.text : theme.node.muted, outlineColor: theme.node.muted }}
                    onClick={() => onChange(option)}>
                    <span className="grid h-4 place-items-center"><SizePreview width={preview.width} height={preview.height} color={selected ? theme.node.text : theme.node.muted} /></span>
                    <span>{automatic ? "Auto" : option}</span>
                </button>;
            })}
        </div>
    </SettingGroup>;
}

function AudioControl({ checked, theme, onChange }: { checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return <SettingGroup title="生成音频" color={theme.node.muted}>
        <div className="grid grid-cols-2 gap-2">
            <OptionPill label="生成音频 开启" selected={checked} theme={theme} onClick={() => onChange(true)}>开启</OptionPill>
            <OptionPill label="生成音频 关闭" selected={!checked} theme={theme} onClick={() => onChange(false)}>关闭</OptionPill>
        </div>
    </SettingGroup>;
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-2">
            <span className="min-w-0 whitespace-nowrap text-[var(--fs-label)]" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span className="shrink-0" onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="sm" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}
