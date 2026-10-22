package app

import (
	"encoding/json"
	"strings"
	"yingce/backend/internal/model"
)

// Persist the same bounded budget before quoting and executing the task. Long
// chapter prompts duplicate dialogue in the script and need more than 16K.
func applyChapterStoryboardOutputBudget(input map[string]any, profile *ModelCapabilityConfig) {
	metadata, _ := input["metadata"].(map[string]any)
	if input["mode"] != "text" || metadataString(metadata, "source") != "short-drama-chapter-storyboard" || profile == nil || profile.Text == nil {
		return
	}
	limit := min(64000, profile.Text.MaxOutputTokens)
	if limit <= 0 {
		return
	}
	options, _ := input["textOptions"].(map[string]any)
	if options == nil {
		options = map[string]any{}
	}
	if requested := intValue(options["maxOutputTokens"]); requested > 0 {
		limit = min(limit, requested)
	}
	options["maxOutputTokens"] = limit
	input["textOptions"] = options
}

// Never mark a truncated chapter storyboard successful or import a partial batch.
func (s *Service) validateStoryboardTaskResult(task model.Task, result map[string]interface{}) error {
	if task.Type != "canvas_text" {
		return nil
	}
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return err
	}
	var input struct {
		Metadata struct {
			Source string `json:"source"`
		} `json:"metadata"`
	}
	if err = json.Unmarshal([]byte(decrypted), &input); err != nil {
		return err
	}
	if input.Metadata.Source != "short-drama-chapter-storyboard" {
		return nil
	}
	text, _ := result["text"].(string)
	if !completeStoryboardJSON(text) {
		return BadAuthRequest("模型返回的分镜未完整结束，可能达到单次输出上限；失败草稿已保留，原分镜未覆盖。请使用新版分批生成")
	}
	return nil
}

func completeStoryboardJSON(text string) bool {
	text = strings.TrimSpace(text)
	if first, last := strings.Index(text, "{"), strings.LastIndex(text, "}"); first >= 0 && last > first {
		text = text[first : last+1]
	}
	var output struct {
		Rows []json.RawMessage `json:"rows"`
	}
	return json.Unmarshal([]byte(text), &output) == nil && len(output.Rows) > 0
}
