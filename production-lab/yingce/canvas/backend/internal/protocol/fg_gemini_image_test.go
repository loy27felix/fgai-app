package protocol

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFGNanoBanana21AdaptiveAnd4KWireContract(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "gateway", "protocol-packages", "fg-wetoken-gemini-image.yingce-plugin"))
	if os.IsNotExist(err) {
		// Standalone backend Docker builds do not include the sibling gateway.
		data, err = os.ReadFile(filepath.Join("testdata", "fg-wetoken-gemini-image.yingce-plugin"))
	}
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("providers: %v", err)
	}
	for _, ratio := range []string{"auto", "adaptive", "16:9", "1:8"} {
		for _, tier := range []string{"1K", "2K", "4K"} {
			spec, err := adapters[0].BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "gemini-nano-banana-2.1", Prompt: "test", AspectRatio: ratio, Quality: tier}})
			if err != nil {
				t.Fatal(err)
			}
			if spec.Path != "/v1/content/models/gemini-nano-banana-2.1:generateContent" {
				t.Fatalf("path: %s", spec.Path)
			}
			config := manifestTestBody(t, spec)["generationConfig"].(map[string]any)["imageConfig"].(map[string]any)
			if config["imageSize"] != tier {
				t.Fatalf("tier: %#v", config)
			}
			value, exists := config["aspectRatio"]
			if ratio == "auto" || ratio == "adaptive" {
				if exists {
					t.Fatalf("automatic ratio must be omitted: %#v", config)
				}
			} else if value != ratio {
				t.Fatalf("ratio: %#v", config)
			}
		}
	}
}
