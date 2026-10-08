import type { CanvasNodeV2 } from "../../../types-v2.ts";
import {fgWorkspace} from '../../../fg-scope';

export function creativeRoleDisplayName(role: CanvasNodeV2["creative_role"]): string {
  const labels:Record<string,string>={general_text:'文本',script:'脚本',general_image:'图片',general_video:'视频',general_audio:'音频',bgm:'背景音乐',editing:'剪辑',product:'产品',character:'角色',scene:'场景',storyboard:'分镜',voiceover:'旁白',sound_effects:'音效'};
  if(fgWorkspace&&labels[role])return labels[role];
  return role
    .split("_")
    .map((part) => part.toLowerCase() === "bgm"
      ? "BGM"
      : `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}
