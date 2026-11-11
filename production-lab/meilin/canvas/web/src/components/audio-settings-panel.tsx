import { useId } from "react";
import { Input, InputNumber, Radio } from "antd";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatOptionsForConfig, audioSpeedLabel, audioVoiceOptionsForConfig, audioSpeedBounds, isSunoAudioConfig, isDoubaoAudioConfig, isSeedAudioConfig, normalizeAudioFormatForConfig, normalizeAudioSpeedForConfig, normalizeAudioVoiceForConfig } from "@/lib/audio-generation";
import { FGVoicePreview } from "@/components/fg-voice-preview";
import { fgSpeechVoices } from "@/lib/fg-speech-voices";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAudioSettingKey } from "@/components/canvas/canvas-audio-settings-popover";

type AudioSettingsPanelProps = { config: AiConfig; onConfigChange: (key: CanvasAudioSettingKey, value: string) => void; theme: CanvasTheme; showTitle?: boolean; className?: string };

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[var(--panel-width-compact)] space-y-4" }: AudioSettingsPanelProps) {
    const listId = useId();
    const streaming = isDoubaoAudioConfig(config);
    const seedAudio = isSeedAudioConfig(config);
    const music = isSunoAudioConfig(config);
    const voice = normalizeAudioVoiceForConfig(config, config.audioVoice);
    const voices = audioVoiceOptionsForConfig(config);
    const currentVoice = voices.some((item) => item.value === voice) ? voices : [{ value: voice, label: voice || "不指定音色" }, ...voices];
    const formats = audioFormatOptionsForConfig(config);
    const format = normalizeAudioFormatForConfig(config, config.audioFormat);
    const speed = normalizeAudioSpeedForConfig(config,config.audioSpeed);
    const speedBounds = audioSpeedBounds(config);
    const selectVoice = (value: string) => onConfigChange("audioVoice", value);
    return (
        <ImageSettingsTheme theme={theme}>
            <section className={className} style={{ color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} aria-label="音频生成参数">
                {showTitle ? <h3 className="text-base font-semibold">音频设置</h3> : null}
                {seedAudio && <p className="text-xs leading-6" style={{ color: theme.node.muted }}>在输入框描述声音、对白和情绪即可生成。提示词最多 3,000 字符；长篇旁白请使用豆包语音合成 2.0。</p>}
                {music && <p className="text-xs leading-6" style={{color:theme.node.muted}}>用提示词描述音乐风格、乐器和情绪。Suno 验证码由公司管理员处理；作品保存后可从资产添加到画布。</p>}
                {!seedAudio && !music && <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs" style={{ color: theme.node.muted }}>
                        音色
                    </legend>
                    {streaming ? (
                        <>
                            <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                无参考素材时按提示词生成；可连接最多 3 段音频或 1 张图片，图片与音频不能混用。
                            </p>
                            <Input aria-label="豆包音色 ID" value={voice} allowClear placeholder="留空按提示词生成，或输入可用的音色 ID" onChange={(event) => selectVoice(event.target.value.trim())} />
                            <p className="text-xs leading-5" style={{ color: theme.node.muted }}>仅填写当前模型已开通的音色或复刻音色 ID；不自动套用旧版音色列表。图片参考模式不使用此音色。</p>
                        </>
                    ) : (
                        <>
                            <Input aria-label="渠道音色 ID" value={voice} list={listId} placeholder="输入渠道音色 ID" onChange={(event) => selectVoice(event.target.value)} />
                            <datalist id={listId}>
                                {currentVoice.map((item) => (
                                    <option value={item.value} key={item.value}>
                                        {item.label}
                                    </option>
                                ))}
                            </datalist>
                            <Radio.Group aria-label="常用音色" value={voice} onChange={(event) => selectVoice(event.target.value)} options={currentVoice} className="flex flex-wrap gap-2" />
                            {fgSpeechVoices.some((item) => item.value === voice) && <FGVoicePreview voice={voice} compact />}
                        </>
                    )}
                </fieldset>}
                <fieldset>
                    <legend className="mb-2 text-xs" style={{ color: theme.node.muted }}>
                        音频格式
                    </legend>
                    <Radio.Group aria-label="音频格式" value={format} options={formats} onChange={(event) => onConfigChange("audioFormat", event.target.value)} className="flex flex-wrap gap-2" />
                </fieldset>
                {!seedAudio && !music && <fieldset className="space-y-2">
                    <legend className="mb-2 text-xs" style={{ color: theme.node.muted }}>
                        语速
                    </legend>
                    <Radio.Group aria-label="常用语速" value={speed} options={["0.75", "1", "1.25", "1.5"].map((value) => ({ value, label: audioSpeedLabel(value) }))} onChange={(event) => onConfigChange("audioSpeed", event.target.value)} />
                    <InputNumber
                        aria-label="自定义语速"
                        min={speedBounds.min}
                        max={speedBounds.max}
                        step={0.05}
                        value={Number(speed)}
                        className="w-full"
                        onChange={(value) => {
                            if (value !== null) onConfigChange("audioSpeed", normalizeAudioSpeedForConfig(config,String(value)));
                        }}
                    />
                    {streaming ? <p className="text-xs leading-5" style={{ color: theme.node.muted }}>1x 为正常语速。情绪克制、低声不等于慢速；提示词也不要重复要求放慢或拖长尾音。</p> : null}
                </fieldset>}
                {streaming ? (
                    <details className="space-y-2 text-xs" style={{ color: theme.node.muted }}>
                        <summary className="cursor-pointer">豆包提示词写法</summary>
                        <p className="leading-5">在节点的提示词输入框中写声音要求和台词；效果需试听确认。</p>
                        <p className="leading-5">建议结构：说话方式 + 情绪与节奏 + 台词原文。默认自然语速、停顿简短，避免反复要求放慢。</p>
                        <p className="leading-5">例如：用自然、亲切的语气说，正常语速，句间短暂停顿，不拖尾音。只说：“大家好，欢迎来到 FG 工作台。”</p>
                        <p className="leading-5">参考音频：连接素材后使用 @Audio1、@Audio2、@Audio3，编号与参考顺序对应。最多 3 段音频或 1 张图片，不能混用。</p>
                        <p className="leading-5">当前豆包协议没有独立发送声音指令、语言和方言参数；这些要求写入节点提示词，不保证每项都能精确执行。</p>
                    </details>
                ) : null}
                {!streaming && !seedAudio && !music ? (
                    <label className="flex flex-col gap-2 text-xs" style={{ color: theme.node.muted }}>
                        声音指令
                        <Input.TextArea aria-label="声音指令" rows={3} value={config.audioInstructions || ""} placeholder="例如：自然、温暖的旁白" onChange={(event) => onConfigChange("audioInstructions", event.target.value)} />
                    </label>
                ) : null}
            </section>
        </ImageSettingsTheme>
    );
}
