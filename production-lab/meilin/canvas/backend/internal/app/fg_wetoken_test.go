package app

import (
	"context"
	"io"
	"meilin/backend/internal/protocol"
	"mime"
	"mime/multipart"
	"testing"
)

func TestFGReferenceFeeStages(t *testing.T) {
	for _, stage := range []string{"poll", "download", "upload", "cancel", "cache-create", "cache-delete"} {
		if providerRequestIsBillable("POST", stage) {
			t.Fatalf("%s is not a second generation charge", stage)
		}
	}
	if !providerRequestIsBillable("POST", "create") {
		t.Fatal("generation submission must be recorded")
	}
}
func TestFGWeTokenHostBoundary(t *testing.T) {
	for _, url := range []string{"http://wetoken.ai/v1", "https://wetoken.ai.attacker.test", "https://elsewhere.test", "https://wetoken.ai@elsewhere.test"} {
		if isFGWeToken(url) {
			t.Fatal(url)
		}
	}
	if !isFGWeToken("https://wetoken.ai/v1") {
		t.Fatal("official https origin")
	}
}
func TestFGAssetStatusContract(t *testing.T) {
	id, status, err := fgAssetResponse([]byte(`{"data":{"Id":"asset-fg123","Status":"Active"}}`))
	if err != nil || id != "asset-fg123" || status != "active" {
		t.Fatal(id, status, err)
	}
	if _, _, err = fgAssetResponse([]byte(`{"id":"not-an-asset"}`)); err == nil {
		t.Fatal("invalid provider id")
	}
	request := protocol.GenerationRequest{Capability: protocol.CapabilityVideo, Model: "dreamina-seedance-2-5-filter-off", Images: []protocol.MediaReference{{URL: "http://localhost/private.png"}}}
	if prepareFGWeTokenAssets(context.Background(), providerConfig{BaseURL: "https://wetoken.ai/v1"}, &request, "task-id") == nil {
		t.Fatal("local reference cannot be sent to the asset library")
	}
}
func TestFGImageReferencesUseEdits(t *testing.T) {
	spec := protocol.RequestSpec{Path: "/v1/images/generations", Body: map[string]any{"prompt": "retain identity", "images": []any{}, "response_format": "b64_json", "size": "2496x1664", "quality": "low"}}
	req := protocol.GenerationRequest{Images: []protocol.MediaReference{{DataURL: "data:image/png;base64,AQ=="}, {DataURL: "data:image/png;base64,Ag=="}, {Role: "mask", DataURL: "data:image/png;base64,Aw=="}}}
	err := prepareFGWeTokenImageEdit(providerConfig{BaseURL: "https://wetoken.ai/v1", InterfaceType: "openai-image"}, req, &spec)
	if err != nil || spec.Path != "/v1/images/edits" || !spec.OriginPath || spec.ContentType != "multipart/form-data" || len(spec.Files) != 3 {
		t.Fatal(spec, err)
	}
	body := spec.Body.(map[string]any)
	for _, key := range []string{"images", "image", "mask", "response_format"} {
		if _, exists := body[key]; exists {
			t.Fatalf("unexpected form field %s", key)
		}
	}
	reader, contentType, err := protocolRequestBody(context.Background(), providerConfig{}, spec)
	if err != nil {
		t.Fatal(err)
	}
	_, parameters, err := mime.ParseMediaType(contentType)
	if err != nil {
		t.Fatal(err)
	}
	form, err := multipart.NewReader(reader, parameters["boundary"]).ReadForm(1 << 20)
	if err != nil {
		t.Fatal(err)
	}
	defer form.RemoveAll()
	if form.Value["size"][0] != "2496x1664" || form.Value["quality"][0] != "low" || len(form.File["image[]"]) != 2 || len(form.File["mask"]) != 1 {
		t.Fatal("incomplete multipart edit")
	}
	for index, file := range append(form.File["image[]"], form.File["mask"]...) {
		part, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(part)
		part.Close()
		if err != nil || len(data) != 1 || data[0] != byte(index+1) {
			t.Fatal("reference file bytes missing", err)
		}
	}
	unchanged := protocol.RequestSpec{Path: "/v1/images/generations"}
	_ = prepareFGWeTokenImageEdit(providerConfig{BaseURL: "https://other.example", InterfaceType: "openai-image"}, req, &unchanged)
	if unchanged.Path != "/v1/images/generations" {
		t.Fatal("other providers must remain unchanged")
	}
}
