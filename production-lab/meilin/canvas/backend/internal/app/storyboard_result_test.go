package app

import (
	"meilin/backend/internal/model"
	"testing"
)

func TestFGChapterStoryboardTaskUsesSourceMetadata(t *testing.T) {
	svc := &Service{}
	task := model.Task{Type: "canvas_text", Operation: "storyboard", InputJSON: `{"metadata":{"source":"short-drama-chapter-storyboard","chapterId":"chapter"}}`}
	if err := svc.validateStoryboardTaskResult(task, map[string]interface{}{"text": `{"rows":[{"description":"未完`}); err == nil {
		t.Fatal("chapter task accepted truncated result")
	}
	if err := svc.validateStoryboardTaskResult(task, map[string]interface{}{"text": `{"rows":[{"description":"雨夜"}]}`}); err != nil {
		t.Fatal(err)
	}
	task.InputJSON = `{"metadata":{"operation":"storyboard","source":"canvas"}}`
	if err := svc.validateStoryboardTaskResult(task, map[string]interface{}{"text": "ordinary canvas text"}); err != nil {
		t.Fatal("unrelated canvas text rejected", err)
	}
}

func TestFGStoryboardRejectsTruncatedResults(t *testing.T) {
	for _, text := range []string{`{"rows":[{"description":"雨夜"},{"description":"未完`, `{"rows":[]}`, `{"rows":[{"description":"雨夜"}],"title":"未完`} {
		if completeStoryboardJSON(text) {
			t.Fatalf("accepted incomplete storyboard: %s", text)
		}
	}
	for _, text := range []string{"```json\n{\"rows\":[{\"description\":\"雨夜\"}]}\n```", `{"title":"分镜","rows":[{"description":"雨夜"}]}`} {
		if !completeStoryboardJSON(text) {
			t.Fatalf("rejected complete storyboard: %s", text)
		}
	}
}
