package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestFGChapterStoryboardBudgetRespectsModelAndRequest(t *testing.T) {
	for _, tc := range []struct{ maximum, requested, want int }{
		{128000, 0, 64000}, {8192, 0, 8192}, {128000, 32000, 32000}, {128000, 256000, 64000},
	} {
		input := map[string]any{"mode": "text", "metadata": map[string]any{"source": "short-drama-chapter-storyboard"}, "textOptions": map[string]any{"stream": false, "maxOutputTokens": tc.requested}}
		applyChapterStoryboardOutputBudget(input, &ModelCapabilityConfig{Text: &TextCapabilityConfig{MaxOutputTokens: tc.maximum}})
		if got := estimateTaskTokens(input).OutputTokens; got != int64(tc.want) {
			t.Fatalf("max=%d requested=%d quote output=%d want=%d", tc.maximum, tc.requested, got, tc.want)
		}
		if input["textOptions"].(map[string]any)["stream"] != false {
			t.Fatal("stream preference changed")
		}
	}
	ordinary := map[string]any{"mode": "text"}
	applyChapterStoryboardOutputBudget(ordinary, &ModelCapabilityConfig{Text: &TextCapabilityConfig{MaxOutputTokens: 128000}})
	if ordinary["textOptions"] != nil {
		t.Fatal("unrelated text task changed")
	}
}

func TestFGTextTaskOutputLimitKeepsOrdinaryBudget(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	for _, tc := range []struct {
		source                   string
		requested, maximum, want int
	}{
		{"", 0, 128000, 16384}, {"short-drama-chapter-storyboard", 0, 128000, 64000},
		{"short-drama-chapter-storyboard", 64000, 8192, 8192}, {"", 1024, 128000, 1024},
	} {
		input := canvasGenerationInput{MaxOutputTokens: tc.maximum, TextOptions: canvasTextOptions{MaxOutputTokens: tc.requested}, Metadata: map[string]any{"source": tc.source}}
		if got := textTaskOutputLimit(input); got != tc.want {
			t.Fatalf("%+v got=%d", tc, got)
		}
	}
}

func TestFGChapterStoryboardUsesAuthoritativeBudgetThroughProvider(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	rows := make([]map[string]any, 20)
	for i := range rows {
		rows[i] = map[string]any{"shotNumber": i + 1, "videoMotionPrompt": strings.Repeat("完整剧情提示词", 500)}
	}
	storyboard, _ := json.Marshal(map[string]any{"rows": rows})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["max_tokens"] != float64(64000) {
			t.Errorf("actual provider budget=%v", body["max_tokens"])
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"content": []any{map[string]any{"type": "text", "text": string(storyboard)}}, "stop_reason": "end_turn"})
	}))
	defer server.Close()
	profile := DefaultModelCapabilityConfigForModel("claude-api", "claude-test")
	profile.Text.MaxOutputTokens = 128000
	profile.Text.ContextWindowTokens = 1000000
	tier := newSelectionPriceTier("text-tier", `{}`, "claude-test", "token")
	tier.InputTokenPriceMicrocredits, tier.OutputTokenPriceMicrocredits = 100, 200
	svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "text", model.ChannelInterfaceClaudeAPI, profile, []model.ChannelModelPriceTier{tier})
	svc.dataDir = t.TempDir()
	channel.BaseURL, channel.APIKey = server.URL, "fixture-key"
	if err := svc.encryptSystemChannelSecrets(&channel); err != nil {
		t.Fatal(err)
	}
	if err := db.Save(&channel).Error; err != nil {
		t.Fatal(err)
	}
	input, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{
		"mode": "text", "prompt": "生成完整章节", "metadata": map[string]any{"source": "short-drama-chapter-storyboard"},
		"textOptions": map[string]any{"stream": false},
		"config":      map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey, "capabilityConfig": map[string]any{"text": map[string]any{"maxOutputTokens": 999999}}},
	}, "canvas_text", "storyboard")
	if err != nil {
		t.Fatal(err)
	}
	if estimateTaskTokens(input).OutputTokens != 64000 {
		t.Fatal("quote budget differs")
	}
	config, err := svc.resolveProviderConfig(providerConfig{ChannelID: channel.ID, Model: channelModel.ModelKey})
	if err != nil {
		t.Fatal(err)
	}
	if config.CapabilityConfig.Text.MaxOutputTokens != 128000 {
		t.Fatal("server model capability not hydrated")
	}
	raw, _ := json.Marshal(input)
	result, err := svc.processCanvasGenerationTask(context.Background(), "user", "project", "canvas_text", "生成完整章节", string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if result["text"] != string(storyboard) {
		t.Fatal("long storyboard was truncated")
	}
	if err := svc.validateStoryboardTaskResult(model.Task{Type: "canvas_text", InputJSON: string(raw)}, result); err != nil {
		t.Fatal(err)
	}
}
