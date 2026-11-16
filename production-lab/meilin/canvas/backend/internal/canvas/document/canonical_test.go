package document

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestCanonicalizePreservesFGEditorsAndIsIdempotent(t *testing.T) {
	raw := []byte(`{"title":"test","timeline":{"clips":[{"id":"audio"}]},"previsScenes":[{"id":"previs"}],"remoteContentHash":"old","nodes":[{"id":"md","type":"markdown","content":"# 剧本","metadata":{"custom":{"type":"markdown"}}},{"id":"html","type":"html","content":"<b>片名</b>"},{"id":"svg","type":"svg","content":"<svg/>"},{"id":"chart","type":"chart"},{"id":"compare","type":"compare"}],"connections":[{"id":"edge"}]}`)
	next, changed, err := Canonicalize(raw)
	if err != nil || !changed {
		t.Fatalf("canonicalize: %v %v", changed, err)
	}
	var before, after map[string]any
	_ = json.Unmarshal(raw, &before)
	_ = json.Unmarshal(next, &after)
	for _, field := range []string{"timeline", "previsScenes", "connections", "title"} {
		if !reflect.DeepEqual(before[field], after[field]) {
			t.Fatalf("changed FG field %s", field)
		}
	}
	nodes := after["nodes"].([]any)
	md := nodes[0].(map[string]any)
	if md["type"] != "text" || md["content"] != "# 剧本" || md["metadata"].(map[string]any)["textFormat"] != "markdown" {
		t.Fatalf("lost formatted text: %v", md)
	}
	for i := 1; i < len(nodes); i++ {
		if !reflect.DeepEqual(before["nodes"].([]any)[i], nodes[i]) {
			t.Fatalf("changed editor %d", i)
		}
	}
	again, changed, err := Canonicalize(next)
	if err != nil || changed || string(again) != string(next) {
		t.Fatal("canonicalization is not idempotent")
	}
	if _, exists := after["remoteContentHash"]; exists {
		t.Fatal("kept stale hash")
	}
}

func TestCanonicalizeRejectsDamagedDocuments(t *testing.T) {
	for _, raw := range []string{`null`, `[]`, `{"nodes":[null]}`, `{"nodes":[{"type":"markdown","metadata":"wrong"}]}`} {
		if _, _, err := Canonicalize([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}
