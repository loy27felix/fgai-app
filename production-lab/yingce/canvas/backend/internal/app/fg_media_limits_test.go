package app

import "testing"

func TestFGH3MixedReferenceLimit(t *testing.T) {
	r := VideoReferenceConfig{MaxTotalReferences: 12}
	in := canvasGenerationInput{ReferenceImages: make([]providerMedia, 9), ReferenceVideos: make([]providerMedia, 3)}
	if err := validateFGReferenceLimits(r, in); err != nil {
		t.Fatal(err)
	}
	in.ReferenceAudios = make([]providerMedia, 1)
	if validateFGReferenceLimits(r, in) == nil {
		t.Fatal("13 mixed references accepted")
	}
}

func TestFGProjectReferencePlaceholderUsesResolvedResourceMIME(t *testing.T) {
	r := VideoReferenceConfig{ImageFormats: []string{"png", "jpeg", "webp"}}
	in := canvasGenerationInput{ReferenceImages: []providerMedia{{Type: "image/*", StorageKey: "resource:character"}}}
	if err := validateFGReferenceLimits(r, in); err != nil {
		t.Fatalf("unresolved project reference: %v", err)
	}
	in.ReferenceImages[0].MimeType = "image/png"
	if err := validateFGReferenceLimits(r, in); err != nil {
		t.Fatal(err)
	}
	in.ReferenceImages[0].MimeType = "image/avif"
	if validateFGReferenceLimits(r, in) == nil {
		t.Fatal("resolved unsupported format must be rejected")
	}
	in.ReferenceImages[0].Type = "image/png"
	if validateFGReferenceLimits(r, in) == nil {
		t.Fatal("client type must not override resolved MIME")
	}
}

func TestFGWanReferenceAndOutputDurationBudget(t *testing.T) {
	r := VideoReferenceConfig{MaxInputOutputDuration: 30, MinImageSide: 240, MaxImageSide: 8000, MaxVideoSide: 4096}
	in := canvasGenerationInput{Config: providerConfig{VideoSeconds: "20"}, ReferenceVideos: []providerMedia{{DurationMs: 10000, Width: 1920, Height: 1080}}}
	if err := validateFGReferenceLimits(r, in); err != nil {
		t.Fatal(err)
	}
	in.Config.VideoSeconds = "21"
	if validateFGReferenceLimits(r, in) == nil {
		t.Fatal("input and output must fit the shared 30 second budget")
	}
	in.Config.VideoSeconds = "20"
	in.ReferenceVideos[0].Width = 5000
	if validateFGReferenceLimits(r, in) == nil {
		t.Fatal("video side must not use the 8000 pixel image limit")
	}
	in.ReferenceVideos = nil
	in.ReferenceImages = []providerMedia{{Width: 5000, Height: 4000}}
	if err := validateFGReferenceLimits(r, in); err != nil {
		t.Fatal(err)
	}
}

func TestFGHappyHorseLanguagePromptLimits(t *testing.T) {
	r := VideoReferenceConfig{PromptMaxChars: 2500, PromptMaxNonChineseChars: 5000}
	if videoPromptMaxChars(r, "An English prompt") != 5000 || videoPromptMaxChars(r, "英文和中文 mixed") != 2500 {
		t.Fatal("language-specific prompt limit lost")
	}
}

func TestFGGPTImageOfficialDimensionBoundaries(t *testing.T) {
	c := &ImageSizeConstraints{MinPixels: 655360, MaxPixels: 8294400, MaxRatio: 3, MaxSide: 3840, EdgeMultiple: 16}
	for _, size := range []string{"1024x1024", "3840x2160", "2160x3840", "2880x2880"} {
		if err := validateFGImageDimensions(size, c); err != nil {
			t.Fatal(size, err)
		}
	}
	for _, size := range []string{"1025x1024", "4096x1024", "512x512", "3840x3840", "3072x512"} {
		if validateFGImageDimensions(size, c) == nil {
			t.Fatal("invalid official size accepted", size)
		}
	}
}

func TestFGReferenceLimitsCheckAggregateAndStrictImageBytes(t *testing.T) {
	r := VideoReferenceConfig{MaxImageBytes: 30 * 1024 * 1024, ImageBytesExclusive: true, MinVideoDuration: 2, MaxTotalVideoDuration: 30, MaxTotalAudioDuration: 30, MinImageSide: 300, MaxImageSide: 6000, MinImageRatio: .4, MaxImageRatio: 2.5, MinVideoPixels: 407696, MaxVideoPixels: 8295044}
	in := canvasGenerationInput{ReferenceVideos: []providerMedia{{DurationMs: 15000, Width: 1280, Height: 720}, {DurationMs: 15000, Width: 1280, Height: 720}}}
	if err := validateFGReferenceLimits(r, in); err != nil {
		t.Fatal(err)
	}
	in.ReferenceVideos[1].DurationMs = 15001
	if validateFGReferenceLimits(r, in) == nil {
		t.Fatal("aggregate duration must be rejected")
	}
	in.ReferenceVideos = nil
	in.ReferenceImages = []providerMedia{{Bytes: 30 * 1024 * 1024}}
	if validateFGReferenceLimits(r, in) == nil {
		t.Fatal("Seedance images must be strictly below 30MB")
	}
	in.ReferenceImages[0].Bytes--
	if err := validateFGReferenceLimits(r, in); err != nil {
		t.Fatal(err)
	}
	in.ReferenceImages[0].Width = 299
	in.ReferenceImages[0].Height = 600
	if validateFGReferenceLimits(r, in) == nil {
		t.Fatal("undersized image must be rejected")
	}
}

func TestFGSeedreamCustomPixelLimits(t *testing.T) {
	c := &ImageSizeConstraints{MinPixels: 3686400, MaxPixels: 16777216, MaxRatio: 16}
	for _, size := range []string{"3750x1250", "4096x4096", "6240x2656"} {
		if err := validateFGImageDimensions(size, c); err != nil {
			t.Fatal(size, err)
		}
	}
	for _, size := range []string{"1500x1500", "8192x8192", "-1x4096", "999999999999x1"} {
		if validateFGImageDimensions(size, c) == nil {
			t.Fatal("invalid size accepted", size)
		}
	}
}
