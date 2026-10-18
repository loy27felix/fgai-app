package app

import (
	"testing"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestFGShortDramaReasoningTaskTimeout(t *testing.T) {
	policy := platform.DefaultRuntimePolicy().Task
	task := &model.Task{Type: "canvas_text", Model: "gpt-6.1-sol", InputJSON: `{"metadata":{"source":"short-drama-chapter-storyboard"}}`}
	if got := taskExecutionTimeout(task, policy); got != 30*time.Minute {
		t.Fatalf("structured high reasoning budget: %v", got)
	}
	task.Model = "claude-sonnet-5-5"
	if got := taskExecutionTimeout(task, policy); got != time.Duration(policy.TextTimeoutMinutes)*time.Minute {
		t.Fatalf("unrelated channel budget changed: %v", got)
	}
	task.Model = "gpt-6.1-sol"
	task.InputJSON = `{"metadata":{"source":"fg-meilin","sourceAction":"studio.prompts"}}`
	if got := taskExecutionTimeout(task, policy); got != 30*time.Minute {
		t.Fatalf("conversational director reasoning budget: %v", got)
	}
	task.InputJSON = `{"metadata":{"source":"ordinary-text"}}`
	if shortDramaReasoningTask(task) {
		t.Fatal("ordinary text incorrectly opted in")
	}
	task.Type = "canvas_video"
	task.InputJSON = `{"metadata":{"source":"short-drama-chapter-storyboard"}}`
	if shortDramaReasoningTask(task) {
		t.Fatal("media budget changed")
	}
}
