package app

import "testing"

func TestFGImageApprovalAcceptsDeclaredRatioWithoutRelaxingVideoSize(t *testing.T) {
	input := map[string]any{"mode": "image", "config": map[string]any{"size": "9:16"}, "capabilityOptions": map[string]any{"size": "1024x1792"}}
	if err := validateCloudAgentResolvedMediaOptions(map[string]any{"size": "9:16"}, input); err != nil {
		t.Fatal(err)
	}
	if err := validateCloudAgentResolvedMediaOptions(map[string]any{"size": "6:1"}, input); err == nil {
		t.Fatal("undeclared image ratio accepted")
	}
	input["mode"] = "video"
	if err := validateCloudAgentResolvedMediaOptions(map[string]any{"size": "9:16"}, input); err == nil {
		t.Fatal("image exception applied to video")
	}
}
