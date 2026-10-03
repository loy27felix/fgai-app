import { useEffect, useState, type ReactNode } from "react";
import { Button, ColorPicker, ConfigProvider, Input, Segmented, Slider, Upload, theme as antdTheme } from "antd";
import {uploadImage} from '@/services/image-storage';
import { CircleDot, Grid2x2, ImagePlus, Moon, Paintbrush, RotateCcw, Save, Square, Sun } from "lucide-react";

import {
    canvasAppearanceForTheme,
    DEFAULT_CANVAS_BACKGROUND_MODE,
    customCanvasAppearanceFromTheme,
    enterCustomCanvasAppearance,
    normalizeHexColor,
    type CanvasAppearance,
    type CanvasCustomAppearance,
} from "@/lib/canvas/canvas-appearance";
import type { CanvasBackgroundMode, CanvasColorTheme, CanvasTheme } from "@/lib/canvas-theme";

const LIGHT_PRESETS = ["#F0F0F0", "#F3DCE5", "#EEE5D8", "#DFE9E6"];
const DARK_PRESETS = ["#14171D", "#252431", "#302D26", "#233039"];

export function CanvasAppearanceControls({
    appearance,
    backgroundMode,
    colorTheme,
    theme,
    onAppearanceChange,
    onSaveAppearanceDefault,
    onBackgroundModeChange,
}: {
    appearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
    colorTheme: CanvasColorTheme;
    theme: CanvasTheme;
    onAppearanceChange: (appearance: CanvasAppearance) => void;
    onSaveAppearanceDefault: (appearance: CanvasAppearance) => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
}) {
    const [draft, setDraft] = useState(appearance);
    const [uploading,setUploading]=useState(false);
    const [uploadError,setUploadError]=useState('');

    useEffect(() => setDraft(appearance), [appearance]);

    const selectFixedTheme = (target: CanvasColorTheme) => {
        const next = canvasAppearanceForTheme(target, draft);
        setDraft(next);
        onAppearanceChange(next);
        onBackgroundModeChange(DEFAULT_CANVAS_BACKGROUND_MODE);
    };
    const selectCustomTheme = () => {
        const next = enterCustomCanvasAppearance(draft, colorTheme);
        setDraft(next);
        onAppearanceChange(next);
    };
    const updateCustom = (patch: Partial<CanvasCustomAppearance>) => {
        const current = draft.mode === "custom" && draft.custom
            ? draft
            : enterCustomCanvasAppearance(draft, colorTheme);
        const next: CanvasAppearance = { mode: "custom", custom: { ...current.custom!, ...patch } };
        setDraft(next);
        onAppearanceChange(next);
    };
    const resetCustom = () => {
        const baseTheme = draft.custom?.baseTheme || colorTheme;
        const next = customCanvasAppearanceFromTheme(baseTheme);
        setDraft(next);
        onAppearanceChange(next);
    };
    const saveAsDefault = () => {
        onAppearanceChange(draft);
        onSaveAppearanceDefault(draft);
    };
    const presets = draft.custom?.baseTheme === "dark" ? DARK_PRESETS : LIGHT_PRESETS;

    return (
        <ConfigProvider theme={{ algorithm: (draft.custom?.baseTheme ?? colorTheme) === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm, token: { colorPrimary: '#6976e9', colorText: theme.node.text, colorBgContainer: theme.node.panel, colorBorder: theme.toolbar.border, borderRadius: 8, controlHeight: 34 } }}>
          <div className="canvas-appearance-controls space-y-3" style={{ color: theme.node.text }}>
            <div className="mt-4 text-xs font-semibold" style={{ color: theme.node.muted }}>主题</div>
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-[var(--dock-item-radius-labeled)] border p-1" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}>
                <ThemeButton active={draft.mode === "light"} label="浅色" theme={theme} onClick={() => selectFixedTheme("light")}><Sun className="size-3.5" /></ThemeButton>
                <ThemeButton active={draft.mode === "dark"} label="深色" theme={theme} onClick={() => selectFixedTheme("dark")}><Moon className="size-3.5" /></ThemeButton>
                <ThemeButton active={draft.mode === "custom"} label="自定义" theme={theme} onClick={selectCustomTheme}><Paintbrush className="size-3.5" /></ThemeButton>
            </div>

            {draft.mode === "custom" && draft.custom ? (
                <section className="space-y-4 rounded-xl border p-4" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }} aria-label="背景设置">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">背景</span>
                        <span className="text-[var(--fs-micro)] opacity-50">{draft.custom.baseTheme === "dark" ? "深色" : "浅色"}界面</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                        {presets.map((color) => (
                            <button key={color} type="button" className="h-10 rounded-lg border-2 transition-transform hover:scale-[1.04] focus-visible:outline focus-visible:outline-2 motion-reduce:transition-none motion-reduce:hover:scale-100" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 80%, #8499c9))`, borderColor: draft.custom?.backgroundColor === color ? '#8b93f8' : theme.toolbar.border }} aria-pressed={draft.custom?.backgroundColor === color} aria-label={`使用背景颜色 ${color}`} title={color} onClick={() => updateCustom({ backgroundColor: color, backgroundBrightness: 0 })} />
                        ))}
                    </div>
                    <Segmented
                        block
                        aria-label="界面样式"
                        value={draft.custom.baseTheme}
                        onChange={(value) => updateCustom({ baseTheme: value as CanvasColorTheme })}
                        options={[
                            { value: "light", label: <span className="inline-flex items-center gap-1"><Sun className="size-3.5" />浅色界面</span> },
                            { value: "dark", label: <span className="inline-flex items-center gap-1"><Moon className="size-3.5" />深色界面</span> },
                        ]}
                    />
                    <ColorField label="画布背景" value={draft.custom.backgroundColor} theme={theme} onChange={(backgroundColor) => updateCustom({ backgroundColor, backgroundBrightness: 0 })} />
                    <SliderField label="明亮度" value={draft.custom.backgroundBrightness} min={-30} max={30} suffix="%" onChange={(backgroundBrightness) => updateCustom({ backgroundBrightness })} />
                    <Upload className="block w-full [&_.ant-upload]:!block [&_.ant-upload]:!w-full" accept="image/*" showUploadList={false} beforeUpload={file=>{
                        setUploading(true);setUploadError('');
                        void uploadImage(file).then(image=>{if(image.pendingRemoteUpload)throw Error('背景尚未保存到 NAS，请重试');updateCustom({backgroundImage:{storageKey:image.storageKey}});}).catch(e=>setUploadError(e.message)).finally(()=>setUploading(false));
                        return false;
                    }}><Button block loading={uploading} icon={<ImagePlus className="size-4" />}>上传背景图片</Button></Upload>
                    {draft.custom.backgroundImage?<Button size="small" block onClick={()=>updateCustom({backgroundImage:undefined})}>移除背景图片</Button>:null}
                    {uploadError?<p role="alert" className="text-xs text-red-500">{uploadError}</p>:null}
                </section>
            ) : null}

            <div className="pt-2 text-xs font-semibold" style={{ color: theme.node.muted }}>网格</div>
            <Segmented
                className="mt-1 w-full !rounded-[var(--dock-item-radius-labeled)] !p-0.5 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-7 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-7 [&_.ant-segmented-item-label]:!text-[var(--fs-tiny)] [&_.ant-segmented-item-label]:!leading-7"
                value={backgroundMode}
                onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                options={[
                    { value: "dots", label: <span className="inline-flex items-center gap-1.5"><CircleDot className="size-3.5" />点</span> },
                    { value: "lines", label: <span className="inline-flex items-center gap-1.5"><Grid2x2 className="size-3.5" />线</span> },
                    { value: "blank", label: <span className="inline-flex items-center gap-1.5"><Square className="size-3.5" />空白</span> },
                ]}
            />
            {draft.mode === 'custom' && draft.custom && backgroundMode !== 'blank' ? <>
              <ColorField label="网格颜色" value={draft.custom.gridColor} theme={theme} onChange={(gridColor) => updateCustom({ gridColor })} />
              <SliderField label="网格强度" value={draft.custom.gridOpacity} min={0} max={100} suffix="%" onChange={(gridOpacity) => updateCustom({ gridOpacity })} />
            </> : null}
            <div className="grid grid-cols-[1fr_1.4fr] gap-2 border-t pt-4" style={{ borderColor: theme.toolbar.border }}>
              <Button disabled={draft.mode !== 'custom'} icon={<RotateCcw className="size-3.5" />} onClick={resetCustom}>重置</Button>
              <Button type="primary" icon={<Save className="size-3.5" />} onClick={saveAsDefault}>保存为默认</Button>
            </div>
          </div>
        </ConfigProvider>
    );
}

function ThemeButton({ active, label, theme, onClick, children }: { active: boolean; label: string; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className="inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-[var(--dock-item-radius)] px-1 text-[var(--fs-tiny)] font-semibold transition-colors" style={active ? { background: theme.node.text, color: theme.node.panel } : { color: theme.toolbar.item }} aria-label={`切换到${label}主题`} aria-pressed={active} title={`切换到${label}主题`} onClick={onClick}>
            {children}<span className="truncate">{label}</span>
        </button>
    );
}

function ColorField({ label, value, theme, onChange }: { label: string; value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    const [textValue, setTextValue] = useState(value);
    const [editing, setEditing] = useState(false);
    useEffect(() => {
        if (!editing) setTextValue(value);
    }, [editing, value]);
    const commit = () => {
        const normalized = normalizeHexColor(textValue);
        setEditing(false);
        if (normalized) {
            setTextValue(normalized);
            onChange(normalized);
        } else {
            setTextValue(value);
        }
    };
    return (
        <label className="grid grid-cols-[minmax(0,1fr)_32px_130px] items-center gap-2 text-xs font-medium">
            <span>{label}</span>
            <ColorPicker disabledAlpha value={value} onChange={(color) => onChange(color.toHexString().toUpperCase())} />
            <Input value={textValue} aria-label={`${label}色码`} style={{ color: theme.node.text }} onFocus={() => setEditing(true)} onChange={(event) => {
                const next = event.target.value;
                setTextValue(next);
                const normalized = normalizeHexColor(next);
                if (normalized) onChange(normalized);
            }} onBlur={commit} onPressEnter={commit} />
        </label>
    );
}

function SliderField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
    return (
        <div className="grid grid-cols-[1fr_auto] items-center gap-y-3 text-xs font-medium">
            <span>{label}</span>
            <span className="text-right tabular-nums opacity-60">{value > 0 && min < 0 ? "+" : ""}{value}{suffix}</span>
            <Slider className="!m-0 col-span-2" min={min} max={max} value={value} tooltip={{ open: false }} onChange={onChange} />
        </div>
    );
}
