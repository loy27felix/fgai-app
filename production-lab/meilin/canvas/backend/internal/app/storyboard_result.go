package app

import (
	"encoding/json"
	"strings"

	"meilin/backend/internal/model"
	"meilin/backend/internal/production"
)

func isDramaScriptMetadata(metadata map[string]any) bool {
	return metadataString(metadata, "source") == "drama_production" && metadataString(metadata, "dramaJobKind") == model.DramaJobScript
}

// Persist the same bounded budget before quoting and executing the task. Long
// chapter prompts duplicate dialogue in the script and need more than 16K.
func applyChapterStoryboardOutputBudget(input map[string]any, profile *ModelCapabilityConfig) {
	metadata, _ := input["metadata"].(map[string]any)
	if input["mode"] != "text" || (metadataString(metadata, "source") != "short-drama-chapter-storyboard" && !isDramaScriptMetadata(metadata)) || profile == nil || profile.Text == nil {
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

// 区分已收到不合格结果与请求未发出，保留原始 HTTP 审计。
// Distinguish invalid generated output from preflight failures without rewriting HTTP logs.
type storyboardResultError struct{ cause error }

func (e *storyboardResultError) Error() string { return e.cause.Error() }
func (e *storyboardResultError) Unwrap() error { return e.cause }

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
		Metadata map[string]any `json:"metadata"`
	}
	if err = json.Unmarshal([]byte(decrypted), &input); err != nil {
		return err
	}
	metadata := input.Metadata
	// 旧的在途任务没有 kind，通过项目内作业确定用途，不误校验其他文本任务。
	// Resolve legacy in-flight tasks by their project-scoped job, not by text mode alone.
	if metadataString(metadata, "source") == "drama_production" && metadataString(metadata, "dramaJobKind") == "" && metadataString(metadata, "dramaJobId") != "" {
		job, err := s.repo.DramaJob(task.ProjectID, metadataString(metadata, "dramaJobId"))
		if err != nil {
			return err
		}
		metadata["dramaJobKind"] = job.Kind
	}
	text, _ := result["text"].(string)
	if isDramaScriptMetadata(metadata) {
		if _, err := production.ParseScript(text); err != nil {
			return &storyboardResultError{cause: BadAuthRequest("分镜生成结果不完整或格式无效，可能达到单次输出上限；原分镜未覆盖。请缩短本集内容或调整模型后重新生成，可能产生新的费用。原因：" + err.Error())}
		}
		return nil
	}
	if metadataString(metadata, "source") != "short-drama-chapter-storyboard" {
		return nil
	}
	if !completeStoryboardJSON(text) {
		var value any
		err := json.Unmarshal([]byte(storyboardJSONBody(text)), &value)
		if err != nil && !strings.Contains(err.Error(), "unexpected end of JSON input") {
			return &storyboardResultError{cause: BadAuthRequest("模型返回的分镜 JSON 格式不合法；失败草稿已保留，原分镜未覆盖。可核对并修正已保存草稿，无需重跑成功批次")}
		}
		return &storyboardResultError{cause: BadAuthRequest("模型返回的分镜未完整结束或没有可用镜头；失败草稿已保留，原分镜未覆盖。请核对草稿或仅重试失败批次")}
	}
	return nil
}

func storyboardJSONBody(text string) string {
	text = strings.TrimSpace(text)
	if first, last := strings.Index(text, "{"), strings.LastIndex(text, "}"); first >= 0 && last > first {
		text = text[first : last+1]
	}
	return text
}

func completeStoryboardJSON(text string) bool {
	var output struct {
		Rows []json.RawMessage `json:"rows"`
	}
	return json.Unmarshal([]byte(storyboardJSONBody(text)), &output) == nil && len(output.Rows) > 0
}
