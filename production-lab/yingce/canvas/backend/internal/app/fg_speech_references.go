package app

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"yingce/backend/internal/protocol"
)

var seedAudioMarker = regexp.MustCompile(`(?i)@(?:audio|音频)([0-9]+)`)

func isFGSeedAudioConfig(config providerConfig) bool {
	parsed, err := url.Parse(config.BaseURL)
	return err == nil && config.Model == "seed-audio-1.0" && config.InterfaceType == "openai-audio" && strings.TrimRight(parsed.Path, "/") == "/internal/fg/speech/v1"
}

// The company gateway uses an OpenAI-shaped envelope, but Seed Audio also needs
// its ordered references. Keep that extension scoped to the company bridge.
func prepareFGSeedAudioRequest(input canvasGenerationInput, spec *protocol.RequestSpec) error {
	if !isFGSeedAudioConfig(input.Config) {
		return nil
	}
	body, ok := spec.Body.(map[string]any)
	if !ok {
		return errors.New("Seed Audio 请求格式无效")
	}
	return addFGSeedAudioReferences(input, body)
}

func addFGSeedAudioReferences(input canvasGenerationInput, body map[string]any) error {
	if len(input.ReferenceVideos) > 0 {
		return errors.New("Seed Audio 不支持参考视频，请先提取音频")
	}
	if len(input.ReferenceAudios) > 3 || len(input.ReferenceImages) > 1 {
		return errors.New("Seed Audio 最多使用 3 段参考音频或 1 张参考图片")
	}
	if len(input.ReferenceAudios) > 0 && len(input.ReferenceImages) > 0 {
		return errors.New("Seed Audio 参考图片和参考音频不能混用")
	}
	refs := make([]map[string]string, 0, len(input.ReferenceAudios)+len(input.ReferenceImages))
	for index, media := range append(append([]providerMedia{}, input.ReferenceAudios...), input.ReferenceImages...) {
		kind := "audio"
		if len(input.ReferenceImages) > 0 {
			kind = "image"
		}
		mime := strings.ToLower(strings.Split(firstNonEmpty(media.MimeType, media.Type), ";")[0])
		if mime != "" && mime != "application/octet-stream" {
			allowed := map[string]bool{"audio/wav": true, "audio/x-wav": true, "audio/mpeg": true, "audio/mp3": true, "audio/pcm": true, "audio/ogg": true, "audio/opus": true}
			if kind == "image" {
				allowed = map[string]bool{"image/jpeg": true, "image/png": true, "image/webp": true}
			}
			if !allowed[mime] {
				return fmt.Errorf("第 %d 个参考素材格式 %s 不受 Seed Audio 支持；样音请使用 WAV、MP3、PCM 或 OGG Opus", index+1, mime)
			}
		}
		if media.Bytes > 10<<20 {
			return fmt.Errorf("第 %d 个参考%s超过 10 MB，请更换素材", index+1, kind)
		}
		if kind == "audio" && media.DurationMs > 30000 {
			return fmt.Errorf("第 %d 个参考音频长于 30 秒，请先截取样音", index+1)
		}
		location := strings.TrimSpace(firstNonEmpty(media.DataURL, media.URL))
		if strings.HasPrefix(location, "data:") {
			parts := strings.SplitN(location, ",", 2)
			if len(parts) != 2 || !strings.HasPrefix(parts[0], "data:"+kind+"/") || !strings.HasSuffix(parts[0], ";base64") {
				return errors.New("Seed Audio 参考素材必须是有效的音频或图片")
			}
			if len(parts[1]) > 4*((10<<20)+2)/3+4 {
				return errors.New("Seed Audio 单个参考素材不得超过 10 MB")
			}
			data, err := base64.StdEncoding.DecodeString(parts[1])
			if err != nil || len(data) == 0 || len(data) > 10<<20 {
				return errors.New("Seed Audio 参考素材编码无效或超过 10 MB")
			}
			refs = append(refs, map[string]string{kind + "_data": parts[1]})
		} else {
			parsed, err := url.Parse(location)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
				return errors.New("Seed Audio 参考素材尚不可读取，请重新选择素材")
			}
			refs = append(refs, map[string]string{kind + "_url": location})
		}
	}
	prompt := seedAudioMarker.ReplaceAllStringFunc(input.Prompt, func(marker string) string {
		parts := seedAudioMarker.FindStringSubmatch(marker)
		return "@音频" + parts[1]
	})
	for _, match := range seedAudioMarker.FindAllStringSubmatch(prompt, -1) {
		index, _ := strconv.Atoi(match[1])
		if index < 1 || index > len(input.ReferenceAudios) {
			return fmt.Errorf("提示词引用了@音频%s，但只提供了 %d 段参考音频，请核对绑定", match[1], len(input.ReferenceAudios))
		}
	}
	if len(input.ReferenceAudios) == 1 && len(seedAudioMarker.FindAllString(prompt, -1)) == 0 {
		prompt = "使用@音频1作为说话人的音色参考，保留其音色身份，按以下内容生成新的音频：\n" + prompt
	}
	if len(input.ReferenceAudios) > 1 {
		for index := range input.ReferenceAudios {
			marker := fmt.Sprintf("@音频%d", index+1)
			found := false
			for _, match := range seedAudioMarker.FindAllString(prompt, -1) {
				if match == marker {
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("有多个参考声音，请在提示词中用%s明确对应角色，不会自动猜测音色", marker)
			}
		}
	}
	if len([]rune(prompt)) > 3000 {
		return errors.New("Seed Audio 提示词最多 3,000 字符，请缩短描述")
	}
	body["input"] = prompt
	if len(refs) > 0 {
		body["references"] = refs
	}
	return nil
}
