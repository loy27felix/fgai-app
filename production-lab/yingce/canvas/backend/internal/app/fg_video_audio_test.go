package app

import (
	"context"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestFGSeedanceAudioSwitchReachesProvider(t *testing.T) {
	adapter, ok := protocol.Builtins().Get("volcengine-ark-video")
	if !ok {
		t.Fatal("missing Ark adapter")
	}
	models := []string{"doubao-seedance-2-0-fast-filter-off", "doubao-seedance-2-0-filter-off", "dreamina-seedance-2-0-mini-filter-off", "dreamina-seedance-2-5-filter-off"}
	for _, name := range models {
		for _, audio := range []struct {
			config string
			want   bool
		}{{"true", true}, {"false", false}, {"", true}} {
			t.Run(name+"/"+audio.config, func(t *testing.T) {
				profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", name).Video
				input := canvasGenerationInput{Mode: "video", Config: providerConfig{Model: name, InterfaceType: "volcengine-ark-video", VideoGenerateAudio: audio.config}, VideoCapability: profile}
				request := protocolRequestFromInput(input)
				if request.GenerateAudio != audio.want || request.Output.GenerateAudio != audio.want {
					t.Fatalf("audio normalization: %#v", request)
				}
				spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
				if err != nil {
					t.Fatal(err)
				}
				value, present := spec.Body.(map[string]any)["generate_audio"]
				if !present || value != audio.want {
					t.Fatalf("provider audio = %v, present=%v, want=%v", value, present, audio.want)
				}
			})
		}
	}
}

func TestFGVideoAudioDefaultRespectsCapability(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		profile := &VideoCapabilityConfig{GenerateAudio: VideoBooleanConfig{Supported: enabled, Default: enabled}}
		request := protocolRequestFromInput(canvasGenerationInput{Mode: "video", VideoCapability: profile})
		if request.GenerateAudio != enabled {
			t.Fatal("model audio default must be preserved")
		}
	}
}
