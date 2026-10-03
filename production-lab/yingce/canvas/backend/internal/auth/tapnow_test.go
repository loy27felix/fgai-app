package auth

import (
	"encoding/json"
	"testing"
)

func TestTapNowStringShortIDsPreserveConnections(t *testing.T) {
	var detail tapNowDetail
	if err := json.Unmarshal([]byte(`{"nodes":[{"id":"image-a","short_id":"n155","type":"image","data":{"src":"https://files.tapnow.media/a.png"}},{"short_id":42,"type":"text","data":{"text":"镜头说明"}}],"connections":[{"id":"edge-a","source":"n155","target":"42"}]}`), &detail); err != nil {
		t.Fatal(err)
	}
	result, err := adaptTapNowDetail(&detail, "194e1122")
	if err != nil {
		t.Fatal(err)
	}
	if result.ImportedNodeCount != 2 || result.ImportedConnectionCount != 1 || result.Nodes[1].Metadata.NodeID != "42" {
		t.Fatalf("string/numeric short IDs lost nodes or connections: %#v", result)
	}
	for _, raw := range []string{`null`, `{}`, `1.5`, `0`} {
		if tapNowShortID(json.RawMessage(raw)) != "" {
			t.Fatalf("unexpected identifier accepted: %s", raw)
		}
	}
}

func TestAdaptTapNowDetailSupportsMediaAndTextNodes(t *testing.T) {
	detail := &tapNowDetail{
		Name: "TapNow 测试画布",
		Nodes: []tapNowRawNode{
			{ID: "image-1", Type: "image", Data: []byte(`{"title":"图片","type":"generate","src":"https://files.tapnow.media/api/conversation/storage/uploads/image.png","prompt":"画面提示词","params":{"model":"gpt-image-2","imageSize":"2K"},"__metadata":{"width":1024,"height":768}}`), Position: struct {
				X float64 `json:"x"`
				Y float64 `json:"y"`
			}{X: 10, Y: 20}, Measured: struct {
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			}{Width: 448, Height: 250}},
			{ID: "video-1", Type: "video", Data: []byte(`{"title":"视频","type":"generate","src":"","taskInfo":{"status":"failed","failedReason":"上游失败"},"params":{"model":"seedance-2.0","aspectRatio":"16:9","duration":8,"resolution":"720p","generateAudio":true},"__metadata":{"width":1280,"height":720,"duration":4.5}}`), Position: struct {
				X float64 `json:"x"`
				Y float64 `json:"y"`
			}{X: 500, Y: 20}, Measured: struct {
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			}{Width: 444, Height: 250}},
			{ID: "audio-1", Type: "audio", Data: []byte(`{"title":"音频","type":"upload","src":"https://files.tapnow.media/api/conversation/storage/uploads/audio-file","prompt":"就这样.wav"}`), Position: struct {
				X float64 `json:"x"`
				Y float64 `json:"y"`
			}{X: 10, Y: 400}, Measured: struct {
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			}{Width: 444, Height: 250}},
			{ID: "text-1", Type: "text", Data: []byte(`{"title":"文本","type":"generate","text":"故事文本"}`), Position: struct {
				X float64 `json:"x"`
				Y float64 `json:"y"`
			}{X: 500, Y: 400}, Measured: struct {
				Width  float64 `json:"width"`
				Height float64 `json:"height"`
			}{Width: 300, Height: 200}},
		},
		Connections: []tapNowRawConnection{{ID: "edge-1", Source: "image-1", Target: "video-1", SourceHandle: "images", TargetHandle: "prompt"}},
	}

	result, err := adaptTapNowDetail(detail, "8872a294")
	if err != nil {
		t.Fatalf("adaptTapNowDetail() error = %v", err)
	}
	if result.ImportedNodeCount != 4 || result.ImportedConnectionCount != 1 {
		t.Fatalf("counts = (%d, %d), want (4, 1)", result.ImportedNodeCount, result.ImportedConnectionCount)
	}
	if result.Nodes[0].Metadata.Provider != "tapnow" || result.Nodes[0].Model != "gpt-image-2" || result.Nodes[0].Quality != "2k" || result.Nodes[0].NaturalWidth != 1024 {
		t.Fatalf("image mapping = %#v", result.Nodes[0])
	}
	if result.Nodes[1].Status != "error" || result.Nodes[1].ErrorDetails != "上游失败" || result.PlaceholderNodeCount != 1 {
		t.Fatalf("failed video mapping = %#v", result.Nodes[1])
	}
	if result.Nodes[1].Size != "16:9" || result.Nodes[1].Seconds != "8" || result.Nodes[1].VQuality != "720p" || result.Nodes[1].GenerateAudio != "true" {
		t.Fatalf("video generation params = %#v", result.Nodes[1])
	}
	if result.Nodes[2].MimeType != "audio/wav" || result.Nodes[3].Type != "text" || result.Nodes[3].Content != "故事文本" {
		t.Fatalf("audio/text mapping = %#v %#v", result.Nodes[2], result.Nodes[3])
	}
	if result.Connections[0].FromHandleID != "images" || result.Connections[0].ToHandleID != "prompt" {
		t.Fatalf("connection handles = %#v", result.Connections[0])
	}
}

func TestAdaptTapNowDetailUsesValueKeyAsTargetHandle(t *testing.T) {
	detail := &tapNowDetail{
		Nodes: []tapNowRawNode{
			{ID: "source", Type: "image", Data: []byte(`{"title":"源图","src":"https://files.tapnow.media/source"}`)},
			{ID: "target", Type: "image", Data: []byte(`{"title":"目标图","src":"https://files.tapnow.media/target"}`)},
		},
		Connections: []tapNowRawConnection{{ID: "edge", Source: "source", Target: "target", Data: map[string]any{"valueKey": "images"}}},
	}
	result, err := adaptTapNowDetail(detail, "8872a294")
	if err != nil {
		t.Fatalf("adaptTapNowDetail() error = %v", err)
	}
	if got := result.Connections[0].ToHandleID; got != "images" {
		t.Fatalf("target handle = %q, want images", got)
	}
}

func TestAdaptTapNowDetailRejectsUntrustedMediaAndKeepsPlaceholder(t *testing.T) {
	detail := &tapNowDetail{Nodes: []tapNowRawNode{{ID: "image-1", Type: "image", Data: []byte(`{"title":"图片","type":"generate","src":"https://evil.example/image.png"}`)}}}
	result, err := adaptTapNowDetail(detail, "share_1")
	if err != nil {
		t.Fatalf("adaptTapNowDetail() error = %v", err)
	}
	if result.Nodes[0].Content != "" || result.Nodes[0].Status != "idle" || result.PlaceholderNodeCount != 1 {
		t.Fatalf("untrusted media handling = %#v", result.Nodes[0])
	}
}
