package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"yingce/backend/internal/protocol"
)

func TestFGSeedAudioDeclarativeRequestPreservesReferenceBytes(t *testing.T) {
	input := canvasGenerationInput{Mode: "audio", Prompt: "男主@Audio1说你好，女主@音频2说再见", Config: providerConfig{Model: "seed-audio-1.0", InterfaceType: "openai-audio", BaseURL: "http://gateway:3010/internal/fg/speech/v1"}, ReferenceAudios: []providerMedia{{DataURL: "data:audio/mpeg;base64,SUQz", MimeType: "audio/mpeg"}, {URL: "https://example.com/voice-b.wav", MimeType: "audio/wav"}}}
	adapter, ok := loadOfficialFallbackRegistry().Resolve("openai-audio")
	if !ok {
		t.Fatal("official audio adapter missing")
	}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(input)})
	if err != nil {
		t.Fatal(err)
	}
	if err = prepareFGSeedAudioRequest(input, &spec); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(spec.Body)
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Input      string              `json:"input"`
		References []map[string]string `json:"references"`
	}
	if err = json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}
	if body.Input != "男主@音频1说你好，女主@音频2说再见" || len(body.References) != 2 || body.References[0]["audio_data"] != "SUQz" || body.References[1]["audio_url"] != "https://example.com/voice-b.wav" {
		t.Fatalf("reference binding changed: %s", encoded)
	}
}

func TestFGSeedAudioReferenceReachesBothAudioExecutionPaths(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	for _, declarative := range []bool{false, true} {
		calls := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			refs, _ := body["references"].([]any)
			if len(refs) != 1 {
				t.Errorf("reference lost: %#v", body)
			} else if refs[0].(map[string]any)["audio_data"] != "SUQz" {
				t.Errorf("wrong reference bytes: %#v", refs)
			}
			if !strings.Contains(body["input"].(string), "@音频1") {
				t.Error("official reference marker missing")
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			w.Write([]byte("ID3test"))
		}))
		input := canvasGenerationInput{Mode: "audio", Prompt: "使用@Audio1说：你好", Config: providerConfig{Model: "seed-audio-1.0", InterfaceType: "openai-audio", BaseURL: server.URL + "/internal/fg/speech/v1", APIKey: "test-key"}, ReferenceAudios: []providerMedia{{DataURL: "data:audio/mpeg;base64,SUQz", DurationMs: 30000, MimeType: "audio/mpeg"}}}
		ctx := context.Background()
		if declarative {
			ctx = withProtocolRegistry(ctx, loadOfficialFallbackRegistry())
		}
		result, err := runAudioTask(ctx, input)
		server.Close()
		if err != nil || result == nil || calls != 1 {
			t.Fatalf("declarative=%v calls=%d err=%v", declarative, calls, err)
		}
	}
}

func TestFGSeedAudioReferencesFailClosedBeforeProvider(t *testing.T) {
	config := providerConfig{Model: "seed-audio-1.0", InterfaceType: "openai-audio", BaseURL: "http://gateway:3010/internal/fg/speech/v1"}
	valid := providerMedia{DataURL: "data:audio/mpeg;base64,SUQz", MimeType: "audio/mpeg"}
	for _, input := range []canvasGenerationInput{
		{Prompt: "@音频2", ReferenceAudios: []providerMedia{valid}},
		{Prompt: "@音频1", ReferenceAudios: []providerMedia{valid, valid}},
		{Prompt: "say hello", ReferenceAudios: []providerMedia{{DataURL: valid.DataURL, DurationMs: 30001}}},
		{Prompt: "say hello", ReferenceAudios: []providerMedia{{DataURL: "data:audio/mp4;base64,SUQz", MimeType: "audio/mp4"}}},
		{Prompt: "say hello", ReferenceAudios: []providerMedia{{URL: "file:///private/voice.mp3"}}},
		{Prompt: "say hello", ReferenceAudios: []providerMedia{valid}, ReferenceImages: []providerMedia{{URL: "https://example.com/image.png"}}},
	} {
		input.Config = config
		spec := protocol.RequestSpec{Body: map[string]any{"input": input.Prompt}}
		if err := prepareFGSeedAudioRequest(input, &spec); err == nil {
			t.Fatalf("invalid reference accepted: %#v", input)
		}
	}
	input := canvasGenerationInput{Prompt: "hello", Config: config, ReferenceAudios: []providerMedia{valid}}
	body := map[string]any{"input": input.Prompt}
	if err := addFGSeedAudioReferences(input, body); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body["input"].(string), "使用@音频1") {
		t.Fatal("single reference binding missing")
	}
	input.Config.BaseURL = "https://other.example/v1"
	untouched := map[string]any{"input": "original"}
	spec := protocol.RequestSpec{Body: untouched}
	if err := prepareFGSeedAudioRequest(input, &spec); err != nil || untouched["input"] != "original" || untouched["references"] != nil {
		t.Fatal("foreign channel modified", err)
	}
}
