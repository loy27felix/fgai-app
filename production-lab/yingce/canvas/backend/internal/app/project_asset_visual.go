package app

import (
	"encoding/json"
	"strings"
	"time"
	"yingce/backend/internal/canvas"
	"yingce/backend/internal/model"
)

type UpdateProjectAssetVisualRequest struct {
	ResourceID string          `json:"resourceId"`
	VersionID  string          `json:"versionId"`
	Definition *map[string]any `json:"definition"`
}

// Scene and prop definitions remain immutable alongside their bound visual media.
func (s *Service) UpdateProjectAssetVisual(userID, projectID, assetID string, req UpdateProjectAssetVisualRequest) (ProjectAssetSummary, error) {
	asset, err := s.repo.ProjectLinkedAsset(userID, projectID, assetID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	visualDefinition := asset.Category == model.AssetCategoryEnvironment || asset.Category == model.AssetCategoryProp
	if !visualDefinition && !(asset.Kind == "image" && asset.Category != model.AssetCategoryCharacter && req.ResourceID != "" && req.Definition == nil) {
		return ProjectAssetSummary{}, BadAuthRequest("此入口用于场景和道具设定")
	}
	resourceID := strings.TrimSpace(req.ResourceID)
	var visualResource *model.Resource
	if resourceID == "" && req.Definition == nil {
		return ProjectAssetSummary{}, BadAuthRequest("请选择图片或填写设定")
	}
	if resourceID != "" {
		resource, resourceErr := s.repo.ResourceForUser(userID, resourceID)
		if resourceErr != nil {
			return ProjectAssetSummary{}, resourceErr
		}
		if resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return ProjectAssetSummary{}, BadAuthRequest("请选择已保存完成的图片")
		}
		visualResource = resource
	}
	storageKey, _, _, _ := projectAssetPreview(asset.PayloadJSON)
	if resourceID != "" && storageKey == "resource:"+resourceID && req.Definition == nil {
		return s.projectAssetSummary(userID, projectID, asset)
	}
	if req.VersionID != "" && req.VersionID != asset.PrimaryVersionID {
		return ProjectAssetSummary{}, BadAuthRequest("资产设定已更新，请刷新后重试；生成图片仍保存在素材库")
	}
	current, err := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	definition := map[string]any{}
	if err = json.Unmarshal([]byte(current.DefinitionJSON), &definition); err != nil {
		return ProjectAssetSummary{}, err
	}
	if req.Definition != nil {
		definition = *req.Definition
	}
	definitionJSON, err := json.Marshal(definition)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	var payload map[string]any
	if err = json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
		return ProjectAssetSummary{}, err
	}
	data, ok := payload["data"].(map[string]any)
	if !ok {
		data = map[string]any{}
		payload["data"] = data
	}
	if visualDefinition {
		data["content"] = projectVisualDefinitionText(definition)
	}
	if resourceID != "" {
		canvas.CompleteImageAssetData(data, *visualResource)
		asset.Kind = "image"
	}
	now := time.Now()
	version := model.AssetVersion{ID: newID(), AssetID: asset.ID, Version: current.Version + 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: string(definitionJSON), Prompt: current.Prompt, CreatedAt: now, UpdatedAt: now}
	asset.PrimaryVersionID = version.ID
	asset.Status = version.Status
	asset.UpdatedAt = now
	payload["kind"] = asset.Kind
	payload["primaryVersionId"] = version.ID
	payload["updatedAt"] = now.Format(time.RFC3339Nano)
	encoded, err := json.Marshal(payload)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	asset.PayloadJSON = string(encoded)
	representations, err := s.repo.AssetRepresentations(current.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if resourceID != "" {
		representations = []model.AssetRepresentation{{ResourceID: resourceID, MediaType: "image", Role: "primary"}}
	}
	for index := range representations {
		representations[index].ID = newID()
		representations[index].TaskID = version.ID
		representations[index].AssetVersionID = version.ID
		representations[index].CreatedAt = now
	}
	if err = s.repo.SaveCharacterVersion(projectID, asset, &version, representations, nil); err != nil {
		return ProjectAssetSummary{}, err
	}
	return s.projectAssetSummary(userID, projectID, asset)
}

func projectVisualDefinitionText(definition map[string]any) string {
	for _, key := range []string{"description", "appearance", "visualDescription", "content"} {
		if value, ok := definition[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	encoded, _ := json.MarshalIndent(definition, "", "  ")
	if len(definition) == 0 {
		return ""
	}
	return string(encoded)
}

func (s *Service) finalizeProjectVisualTask(task model.Task, result map[string]interface{}) error {
	if !strings.Contains(task.InputJSON, "project_asset_image") {
		return nil
	}
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return err
	}
	var input struct {
		Metadata struct {
			Operation string `json:"operation"`
			AssetID   string `json:"assetId"`
			VersionID string `json:"assetVersionId"`
		} `json:"metadata"`
	}
	if err = json.Unmarshal([]byte(decrypted), &input); err != nil {
		return err
	}
	if input.Metadata.Operation != "project_asset_image" {
		return nil
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	var output characterTurnaroundTaskResult
	if err = json.Unmarshal(encoded, &output); err != nil {
		return err
	}
	if len(output.Images) == 0 || output.Images[0].ResourceID == "" {
		return BadAuthRequest("设定图没有返回已保存的图片资源")
	}
	s.characterTaskMu.Lock()
	defer s.characterTaskMu.Unlock()
	_, err = s.UpdateProjectAssetVisual(task.UserID, task.ProjectID, input.Metadata.AssetID, UpdateProjectAssetVisualRequest{ResourceID: output.Images[0].ResourceID, VersionID: input.Metadata.VersionID})
	return err
}
