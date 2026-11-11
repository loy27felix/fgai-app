package app

import (
	"context"
	"encoding/json"
	"meilin/backend/internal/model"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFGClaudeCanvasToolsPreserveServerSchemaWithoutUnsupportedRootCombinators(t *testing.T) {
	for _, wire := range []model.ChannelInterfaceType{model.ChannelInterfaceClaudeAPI, model.ChannelInterfaceChatCompletion} {
		t.Run(string(wire), func(t *testing.T) { verifyFGClaudeToolsTransport(t, string(wire)) })
	}
}

func verifyFGClaudeToolsTransport(t *testing.T, wire string) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	req := CloudAgentRequest{PermissionMode: "auto", ContextScope: []string{"canvas"}}
	tools := cloudAgentTools(req)
	canonical := canonicalAgentRequest{Tools: tools, ToolChoice: "auto", Messages: []map[string]interface{}{{"role": "user", "content": "Generate two images"}}}
	original, _ := json.Marshal(tools)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		found := false
		for _, raw := range body["tools"].([]interface{}) {
			tool := raw.(map[string]interface{})
			if function, ok := tool["function"].(map[string]interface{}); ok {
				tool = function
			}
			schema, ok := tool["input_schema"].(map[string]interface{})
			if !ok {
				schema = tool["parameters"].(map[string]interface{})
			}
			for _, key := range []string{"oneOf", "allOf", "anyOf"} {
				if _, ok := schema[key]; ok {
					t.Errorf("Claude tool %s contains unsupported root %s", tool["name"], key)
				}
			}
			if tool["name"] == "generate_media" {
				found = true
				if schema["properties"] == nil || schema["required"] == nil {
					t.Error("lost generation fields")
				}
				if !strings.Contains(stringField(tool, "description"), "Additional argument constraints, enforced by the server") {
					t.Error("lost cross-field argument rules")
				}
			}
		}
		if !found {
			t.Error("lost media generation tool")
		}
		w.Header().Set("Content-Type", "application/json")
		if wire == string(model.ChannelInterfaceClaudeAPI) {
			_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"verified"}]}`))
		} else {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"verified"}}]}`))
		}
	}))
	defer server.Close()
	_, err := runAgentToolTask(context.Background(), canvasGenerationInput{Config: providerConfig{BaseURL: server.URL, APIKey: "test", Model: "claude-opus-test", InterfaceType: wire}, AgentRequests: &agentToolRequests{Canonical: &canonical}})
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(tools)
	if string(original) != string(after) {
		t.Fatal("transport modified authoritative tool schema")
	}
}

func TestFGClaudeToolProjectionPreservesNestedRules(t *testing.T) {
	schema := map[string]interface{}{"type": "object", "properties": map[string]interface{}{"nested": map[string]interface{}{"oneOf": []interface{}{map[string]interface{}{"type": "string"}, map[string]interface{}{"type": "number"}}}}, "allOf": []interface{}{map[string]interface{}{"required": []string{"nested"}}}, "anyOf": []interface{}{map[string]interface{}{"required": []string{"nested"}}}}
	body := map[string]interface{}{"tools": []interface{}{map[string]interface{}{"name": "example", "description": "original", "input_schema": schema}}}
	normalizeClaudeAgentToolSchemas(body)
	projected := body["tools"].([]interface{})[0].(map[string]interface{})["input_schema"].(map[string]interface{})
	if projected["allOf"] != nil || projected["anyOf"] != nil {
		t.Fatal("unsupported root rules survived")
	}
	if schema["allOf"] == nil || schema["anyOf"] == nil {
		t.Fatal("original schema changed")
	}
	if projected["properties"].(map[string]interface{})["nested"].(map[string]interface{})["oneOf"] == nil {
		t.Fatal("nested field rules lost")
	}
}
