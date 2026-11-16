package canvas

import (
	"encoding/json"
	"meilin/backend/internal/model"
	"strings"
)

// CompleteImageAssetData uses the saved resource, never browser guesses or inline media.
func CompleteImageAssetData(data map[string]any, resource model.Resource) {
	data["storageKey"] = "resource:" + resource.ID
	data["dataUrl"] = ""
	data["width"], data["height"] = resource.Width, resource.Height
	data["bytes"] = resource.Size
	data["mimeType"] = resource.MimeType
	if strings.TrimSpace(resource.MimeType) == "" {
		data["mimeType"] = "application/octet-stream"
	}
}

// HydrateAssetForClient repairs the read view of historical scene/prop records.
// It does not write a repaired snapshot back, omit assets, or expose another owner's resource.
func (s *Service) HydrateAssetForClient(userID string, asset model.Asset) model.Asset {
	if asset.Kind != "image" || asset.UserID != userID {
		return asset
	}
	var payload map[string]any
	if json.Unmarshal([]byte(asset.PayloadJSON), &payload) != nil {
		return asset
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		return asset
	}
	_, hasURL := data["dataUrl"].(string)
	mime, hasMIME := data["mimeType"].(string)
	_, hasBytes := jsonNumberValue(data["bytes"])
	if hasURL && hasMIME && strings.TrimSpace(mime) != "" && !strings.Contains(mime, "*") && hasBytes {
		return asset
	}
	key, _ := data["storageKey"].(string)
	if !strings.HasPrefix(key, "resource:") {
		return asset
	}
	resource, err := s.repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
	if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return asset
	}
	CompleteImageAssetData(data, *resource)
	if raw, err := json.Marshal(payload); err == nil {
		asset.PayloadJSON = string(raw)
	}
	return asset
}
