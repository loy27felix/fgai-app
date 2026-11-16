package app

import (
	"encoding/json"
	"testing"
)

func TestFGStreamSeparatesSequentialToolIDsSharingWireIndex(t *testing.T) {
	p := newStreamingAgentParser("chat-completion", nil)
	for _, id := range []string{"lamp", "study"} {
		for _, f := range []map[string]any{
			{"index": 0, "id": id, "function": map[string]any{"name": "generate_media", "arguments": ""}},
			{"index": 0, "function": map[string]any{"arguments": `{"nodeId":"`}},
			{"index": 0, "function": map[string]any{"arguments": id + `"}`}},
		} {
			b, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{f}}}}})
			p.consume("text/event-stream", append(append([]byte("data: "), b...), []byte("\n\n")...))
		}
	}
	p.consume("text/event-stream", []byte("data: [DONE]\n\n"))
	p.flush()
	result, err := p.result()
	if err != nil {
		t.Fatal(err)
	}
	calls := interfaceSlice(result["toolCalls"])
	if len(calls) != 2 {
		t.Fatalf("calls=%#v", calls)
	}
	for i, id := range []string{"lamp", "study"} {
		call := calls[i].(map[string]any)
		f := call["function"].(map[string]any)
		if call["id"] != id || f["name"] != "generate_media" || f["arguments"] != `{"nodeId":"`+id+`"}` {
			t.Fatal(call)
		}
	}
}

func TestFGStreamEmptyArgumentToolBeforeReusedIndexBatch(t *testing.T) {
	p := newStreamingAgentParser("chat-completion", nil)
	frames := []map[string]any{
		{"index": 0, "id": "read", "function": map[string]any{"name": "canvas_get_state", "arguments": ""}},
		{"index": 0, "id": "first", "function": map[string]any{"name": "task_get", "arguments": ""}},
		{"index": 0, "function": map[string]any{"arguments": `{"taskId":"one"}`}},
		{"index": 1, "id": "second", "function": map[string]any{"name": "task_get", "arguments": ""}},
		{"index": 1, "function": map[string]any{"arguments": `{"taskId":"two"}`}},
	}
	for _, frame := range frames {
		p.consumeChatCompletionEvent(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{frame}}}}})
	}
	p.consume("text/event-stream", []byte("data: [DONE]\n\n"))
	result, err := p.result()
	if err != nil {
		t.Fatal(err)
	}
	calls := interfaceSlice(result["toolCalls"])
	if len(calls) != 3 {
		t.Fatal(calls)
	}
	for i, want := range []string{`{}`, `{"taskId":"one"}`, `{"taskId":"two"}`} {
		call := calls[i].(map[string]any)
		if call["function"].(map[string]any)["arguments"] != want {
			t.Fatal(call)
		}
	}
}
