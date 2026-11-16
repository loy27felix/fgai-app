package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"meilin/backend/internal/model"
	"meilin/backend/internal/repository"
)

func TestDramaStoryboardBudgetAndIsolation(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	for _, tc := range []struct {
		name, source, kind       string
		maximum, requested, want int
	}{
		{"script", "drama_production", model.DramaJobScript, 128000, 0, 64000},
		{"model_limit", "drama_production", model.DramaJobScript, 8192, 0, 8192},
		{"explicit_limit", "drama_production", model.DramaJobScript, 128000, 32000, 32000},
		{"bounded", "drama_production", model.DramaJobScript, 128000, 256000, 64000},
		{"bible", "drama_production", model.DramaJobBible, 128000, 0, 16384},
		{"plan", "drama_production", model.DramaJobPlan, 128000, 0, 16384},
		{"segment", "drama_production", model.DramaJobSegmentPrompt, 128000, 0, 16384},
		{"other_source", "canvas", model.DramaJobScript, 128000, 0, 16384},
	} {
		t.Run(tc.name, func(t *testing.T) {
			metadata := map[string]any{"source": tc.source, "dramaJobKind": tc.kind}
			options := map[string]any{"stream": true, "maxOutputTokens": tc.requested}
			input := map[string]any{"mode": "text", "metadata": metadata, "textOptions": options}
			applyChapterStoryboardOutputBudget(input, &ModelCapabilityConfig{Text: &TextCapabilityConfig{MaxOutputTokens: tc.maximum}})
			limit := textTaskOutputLimit(canvasGenerationInput{MaxOutputTokens: tc.maximum, Metadata: metadata, TextOptions: canvasTextOptions{MaxOutputTokens: intValue(options["maxOutputTokens"])}})
			if limit != tc.want || options["stream"] != true {
				t.Fatalf("limit=%d options=%v want=%d", limit, options, tc.want)
			}
			if tc.source == "drama_production" && tc.kind == model.DramaJobScript && estimateTaskTokens(input).OutputTokens != int64(tc.want) {
				t.Fatal("quote and execution budgets differ")
			}
			if !isDramaScriptMetadata(metadata) && intValue(options["maxOutputTokens"]) != tc.requested {
				t.Fatal("unrelated task budget changed")
			}
		})
	}
}

func TestDramaStoryboardActualProviderBudget(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, wire := range []model.ChannelInterfaceType{model.ChannelInterfaceChatCompletion, model.ChannelInterfaceClaudeAPI, model.ChannelInterfaceOpenAIResponse} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%t", wire, stream), func(t *testing.T) {
				text := `{"shots":[{"action":"` + strings.Repeat("完整剧情", 6000) + `"}]}`
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
					}
					field := "max_tokens"
					if wire == model.ChannelInterfaceOpenAIResponse {
						field = "max_output_tokens"
					}
					if body[field] != float64(64000) {
						t.Errorf("actual request %s=%v", field, body[field])
					}
					if stream && body["stream"] != true {
						t.Error("streaming disabled")
					}
					var payload map[string]any
					switch wire {
					case model.ChannelInterfaceClaudeAPI:
						payload = map[string]any{"content": []any{map[string]any{"type": "text", "text": text}}, "stop_reason": "end_turn"}
					case model.ChannelInterfaceOpenAIResponse:
						payload = map[string]any{"status": "completed", "output_text": text, "output": []any{map[string]any{"type": "message", "content": []any{map[string]any{"type": "output_text", "text": text}}}}}
					default:
						payload = map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": text}, "finish_reason": "stop"}}}
					}
					if !stream {
						w.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(w).Encode(payload)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					switch wire {
					case model.ChannelInterfaceClaudeAPI:
						payload = map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "text_delta", "text": text}}
					case model.ChannelInterfaceOpenAIResponse:
						payload = map[string]any{"type": "response.completed", "response": payload}
					default:
						payload = map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": text}, "finish_reason": "stop"}}}
					}
					encoded, _ := json.Marshal(payload)
					fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", encoded)
				}))
				defer server.Close()
				profile := DefaultModelCapabilityConfigForModel(string(wire), "claude-test")
				profile.Text.MaxOutputTokens, profile.Text.ContextWindowTokens = 128000, 1000000
				tier := newSelectionPriceTier("text-tier", `{}`, "claude-test", "token")
				tier.InputTokenPriceMicrocredits, tier.OutputTokenPriceMicrocredits = 100, 200
				svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "text", wire, profile, []model.ChannelModelPriceTier{tier})
				svc.dataDir = t.TempDir()
				channel.BaseURL, channel.APIKey = server.URL, "fixture-key"
				if err := svc.encryptSystemChannelSecrets(&channel); err != nil {
					t.Fatal(err)
				}
				if err := db.Save(&channel).Error; err != nil {
					t.Fatal(err)
				}
				run := dramaRun{project: &model.Project{ID: "project"}}
				input := run.textInput(&model.DramaJob{ID: "job", Kind: model.DramaJobScript}, "分镜", "")
				input["mode"], input["prompt"] = "text", "完整分镜"
				input["textOptions"] = map[string]any{"stream": stream}
				input["config"].(map[string]any)["channelId"] = channel.ID
				input["config"].(map[string]any)["model"] = channelModel.ModelKey
				input, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_text", "text")
				if err != nil {
					t.Fatal(err)
				}
				if estimateTaskTokens(input).OutputTokens != 64000 {
					t.Fatal("quote budget not updated")
				}
				raw, _ := json.Marshal(input)
				if err := db.AutoMigrate(&model.Task{}, &model.TaskLog{}, &model.TaskTextDelta{}, &model.SystemSetting{}); err != nil {
					t.Fatal(err)
				}
				if err := db.Create(&model.Task{ID: "provider-task", UserID: "user", Type: "canvas_text", Status: model.TaskStatusRunning}).Error; err != nil {
					t.Fatal(err)
				}
				result, err := svc.processCanvasGenerationTask(withTaskExecutionID(t.Context(), "provider-task"), "user", "project", "canvas_text", "完整分镜", string(raw))
				if err != nil {
					t.Fatal(err)
				}
				if calls.Load() != 1 || result["text"] != text {
					t.Fatalf("calls=%d or incomplete result", calls.Load())
				}
				if err := svc.validateStoryboardTaskResult(model.Task{Type: "canvas_text", InputJSON: string(raw)}, result); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestDramaStoryboardValidationAndLegacyScope(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	for _, job := range []model.DramaJob{{ID: "script", ProjectID: "project", Kind: model.DramaJobScript}, {ID: "bible", ProjectID: "project", Kind: model.DramaJobBible}} {
		if err := db.Create(&job).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		name, metadata, text string
		invalid              bool
	}{
		{"truncated", `"dramaJobKind":"script"`, `{"shots":[{"action":"未完`, true},
		{"empty", `"dramaJobKind":"script"`, `{"shots":[]}`, true},
		{"wrong_shape", `"dramaJobKind":"script"`, `{"rows":[{"action":"雨夜"}]}`, true},
		{"unusable", `"dramaJobKind":"script"`, `{"shots":[{}]}`, true},
		{"valid", `"dramaJobKind":"script"`, "```json\n{\"shots\":[{\"action\":\"雨夜\"}]}\n```", false},
		{"bible", `"dramaJobKind":"bible"`, `{"characters":[]}`, false},
		{"legacy_script", `"dramaJobId":"script"`, `{"shots":[`, true},
		{"legacy_bible", `"dramaJobId":"bible"`, `{"characters":[]}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			task := model.Task{ProjectID: "project", Type: "canvas_text", InputJSON: `{"metadata":{"source":"drama_production",` + tc.metadata + `}}`}
			err := svc.validateStoryboardTaskResult(task, map[string]any{"text": tc.text})
			var invalid *storyboardResultError
			if errors.As(err, &invalid) != tc.invalid || (!tc.invalid && err != nil) {
				t.Fatalf("validation=%v want invalid=%t", err, tc.invalid)
			}
		})
	}
	if err := svc.validateStoryboardTaskResult(model.Task{ProjectID: "other", Type: "canvas_text", InputJSON: `{"metadata":{"source":"drama_production","dramaJobId":"script"}}`}, map[string]any{"text": `{"shots":[{"action":"雨夜"}]}`}); err == nil {
		t.Fatal("legacy job crossed project boundary")
	}
}

func TestDramaStoryboardFailureAuditAndDraft(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	task := &model.Task{ID: "script", UserID: "user", Type: "canvas_text", Status: model.TaskStatusRunning, BillingOrderID: "paid-order", InputJSON: `{"metadata":{"source":"drama_production","dramaJobKind":"script"}}`}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	text := `{"shots":[{"action":"未完`
	if _, err := svc.repo.AppendTaskTextDelta(task.UserID, task.ID, text, time.Now().Add(time.Hour), repository.TextReplayLimits{MaxTaskBytes: 10000, MaxUserBytes: 10000, MaxTaskEvents: 10}); err != nil {
		t.Fatal(err)
	}
	success := model.ApiCallLog{ID: "upstream", TaskID: task.ID, UserID: task.UserID, Capability: "text", RequestKind: "create", Status: model.ApiCallStatusSucceeded, StatusCode: 200, Billable: true, CreatedAt: time.Now()}
	if err := db.Create(&success).Error; err != nil {
		t.Fatal(err)
	}
	validationErr := svc.validateStoryboardTaskResult(*task, map[string]any{"text": text})
	if validationErr == nil {
		t.Fatal("truncated JSON accepted")
	}
	billing := &taskTerminalBillingStub{}
	terminal := newTaskTerminalCoordinatorForTest(svc.repo, billing, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{})
	terminal.replay, terminal.logFailedAttempt = svc, svc.ensureFailedProviderAttemptLogged
	_ = terminal.handleExecutionFailure(task, validationErr, true, false)
	stored, err := svc.repo.Task(task.ID)
	if err != nil || stored.Status != model.TaskStatusFailed || stored.TextDraft != text || !strings.Contains(stored.Error, "分镜生成结果") {
		t.Fatalf("failed task=%+v err=%v", stored, err)
	}
	if len(billing.uncertain) != 1 || len(billing.refund) != 0 || billing.settleCalls != 0 {
		t.Fatalf("incorrect settlement=%+v", billing)
	}
	svc.ensureFailedProviderAttemptLogged(*stored, validationErr)
	logs, total, err := svc.repo.QueryAPICallLogs(repository.APICallLogFilter{AnalyticsFilter: repository.AnalyticsFilter{From: time.Now().Add(-time.Hour), To: time.Now().Add(time.Hour)}, Status: "failed", RecordType: "request", Limit: 20})
	if err != nil || total != 1 || len(logs) != 1 {
		t.Fatalf("failed filter total=%d logs=%v err=%v", total, logs, err)
	}
	entry := logs[0]
	if entry.ErrorCode != "invalid_storyboard_result" || entry.Method != "INTERNAL" || entry.Path != "/task/result-validation" || entry.Billable || entry.StatusCode != 0 || entry.TaskID != task.ID {
		t.Fatalf("wrong audit=%+v", entry)
	}
	var original model.ApiCallLog
	if err := db.First(&original, "id = ?", success.ID).Error; err != nil {
		t.Fatal(err)
	}
	if original.Status != model.ApiCallStatusSucceeded || original.StatusCode != 200 || !original.Billable {
		t.Fatal("upstream HTTP evidence changed")
	}
}

func TestDramaStoryboardRetrySeparatesInvalidAndReusableResults(t *testing.T) {
	for _, invalid := range []bool{true, false} {
		t.Run(fmt.Sprintf("invalid=%t", invalid), func(t *testing.T) {
			svc, fake := newDramaTestService(t)
			project := createTestDramaWithMedia(t, svc, DramaReviewEvery, DramaMediaManual).Project.ID
			runDramaTicks(t, svc, project, 15)
			jobs, err := svc.repo.DramaJobsByStatus(project, model.DramaJobSucceeded)
			if err != nil {
				t.Fatal(err)
			}
			var script *model.DramaJob
			for i := range jobs {
				if jobs[i].Kind == model.DramaJobScript {
					script = &jobs[i]
					break
				}
			}
			if script == nil {
				t.Fatal("script not generated")
			}
			task, err := svc.repo.Task(script.TaskID)
			if err != nil {
				t.Fatal(err)
			}
			if invalid {
				raw, _ := json.Marshal(map[string]any{"text": `{"shots":[{"action":"未完`})
				task.ResultJSON = string(raw)
				if err := fake.db.Save(task).Error; err != nil {
					t.Fatal(err)
				}
			}
			original := task.ResultJSON
			script.Status, script.Error = model.DramaJobFailed, "结果处理失败"
			if err := svc.repo.SaveDramaJob(script); err != nil {
				t.Fatal(err)
			}
			var payload dramaRevisionPayload
			if err := json.Unmarshal([]byte(script.PayloadJSON), &payload); err != nil {
				t.Fatal(err)
			}
			if err := fake.db.Model(&model.DramaEpisode{}).Where("id = ?", script.EpisodeID).Updates(map[string]any{"stage": model.DramaEpisodeScript, "error": "结果处理失败", "revision": payload.Revision}).Error; err != nil {
				t.Fatal(err)
			}
			before := fake.byKind["script"]
			runDramaTicks(t, svc, project, 2)
			if fake.byKind["script"] != before {
				t.Fatal("failed script regenerated without user retry")
			}
			if _, err := svc.RetryFailedDrama("usr-drama", project); err != nil {
				t.Fatal(err)
			}
			retrying, err := svc.repo.DramaEpisode(project, script.EpisodeID)
			if err != nil || retrying.Revision != payload.Revision {
				t.Fatalf("retry invalidated paid output revision: %+v %v", retrying, err)
			}
			runDramaTicks(t, svc, project, 12)
			want := before
			if invalid {
				want++
			}
			if fake.byKind["script"] != want {
				t.Fatalf("script calls=%d want=%d", fake.byKind["script"], want)
			}
			episode, err := svc.repo.DramaEpisode(project, script.EpisodeID)
			if err != nil || episode.Stage == model.DramaEpisodeScript || episode.Error != "" {
				t.Fatalf("episode did not recover=%+v err=%v", episode, err)
			}
			oldTask, err := svc.repo.Task(task.ID)
			if err != nil || oldTask.Status != model.TaskStatusSucceeded || oldTask.ResultJSON != original {
				t.Fatal("historical evidence changed", err)
			}
			latest, err := svc.repo.LatestDramaJob(project, model.DramaJobScript, script.EpisodeID)
			if err != nil || (latest.TaskID == task.ID) == invalid {
				t.Fatalf("retry task identity=%+v err=%v", latest, err)
			}
		})
	}
}
