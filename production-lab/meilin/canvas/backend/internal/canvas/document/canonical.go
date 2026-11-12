// Package document owns representation changes at canvas persistence boundaries.
package document

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// FG retains HTML, SVG, charts, comparison and timeline editors. Only legacy
// Markdown becomes formatted text; nested metadata and plugin nodes stay opaque.
func Canonicalize(raw []byte) ([]byte, bool, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return raw, false, nil
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil || doc == nil {
		return nil, false, fmt.Errorf("画布文档不是有效 JSON 对象")
	}
	if len(doc["nodes"]) == 0 || bytes.Equal(bytes.TrimSpace(doc["nodes"]), []byte("null")) {
		return raw, false, nil
	}
	var nodes []map[string]json.RawMessage
	if err := json.Unmarshal(doc["nodes"], &nodes); err != nil {
		return nil, false, err
	}
	changed := false
	for _, node := range nodes {
		if node == nil {
			return nil, false, fmt.Errorf("画布包含空节点")
		}
		var kind string
		_ = json.Unmarshal(node["type"], &kind)
		if kind != "markdown" {
			continue
		}
		metadata := map[string]json.RawMessage{}
		if value := bytes.TrimSpace(node["metadata"]); len(value) != 0 && !bytes.Equal(value, []byte("null")) {
			if err := json.Unmarshal(value, &metadata); err != nil || metadata == nil {
				return nil, false, fmt.Errorf("Markdown metadata 无效，未覆盖原文")
			}
		}
		metadata["textFormat"] = json.RawMessage(`"markdown"`)
		node["metadata"], _ = json.Marshal(metadata)
		node["type"] = json.RawMessage(`"text"`)
		changed = true
	}
	if !changed {
		return raw, false, nil
	}
	doc["nodes"], _ = json.Marshal(nodes)
	delete(doc, "remoteContentHash")
	encoded, err := json.Marshal(doc)
	return encoded, true, err
}

// SnapshotHash is the existing Agent mutation/undo hash contract. Presentation
// timestamps and viewport do not participate; unknown business fields still do.
func SnapshotHash(doc map[string]any) string {
	content := make(map[string]any, len(doc))
	for key, value := range doc {
		switch key {
		case "id", "viewport", "updatedAt", "revision", "createdAt":
			continue
		case "title", "projectId":
			if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
				continue
			}
		}
		content[key] = value
	}
	for _, key := range []string{"nodes", "connections"} {
		if value, exists := content[key]; !exists || value == nil {
			content[key] = []any{}
		}
	}
	content["nodes"] = nodesWithoutTimestamps(content["nodes"])
	encoded, _ := json.Marshal(content)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func nodesWithoutTimestamps(value any) any {
	items, ok := value.([]any)
	if !ok {
		if typed, isMaps := value.([]map[string]any); isMaps {
			items = make([]any, len(typed))
			for index, node := range typed {
				items[index] = node
			}
		} else {
			return value
		}
	}
	projected := make([]any, len(items))
	for index, item := range items {
		node, isMap := item.(map[string]any)
		if !isMap {
			projected[index] = item
			continue
		}
		copy := make(map[string]any, len(node))
		for key, field := range node {
			if key != "createdAt" && key != "updatedAt" {
				copy[key] = field
			}
		}
		projected[index] = copy
	}
	return projected
}
