package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestFGReasoningStreamActivityBeforeStructuredBody(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	thinking := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"planning\"}}]}\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-thinking:
		case <-time.After(time.Second):
			t.Error("reasoning activity was buffered until body")
			return
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"shots\\\":[]}\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	var content strings.Builder
	result, err := requestTextProvider(ctx, providerConfig{BaseURL: server.URL, APIKey: "fixture-key"}, "/chat/completions", map[string]interface{}{"model": "gpt-6.1-sol"}, "chat-completion", true, func(delta string) { content.WriteString(delta) }, func(delta string) {
		if delta != "planning" {
			t.Errorf("unexpected reasoning %q", delta)
		}
		thinking <- struct{}{}
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Text != `{"shots":[]}` || content.String() != result.Text {
		t.Fatalf("reasoning contaminated JSON: %+v content=%q", result, content.String())
	}
}
