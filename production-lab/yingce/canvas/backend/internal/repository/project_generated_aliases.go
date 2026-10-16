package repository

import (
	"encoding/json"
	"yingce/backend/internal/model"
)

// Hide only the untouched media archive of a targeted generation whose image is
// already bound to that exact project asset. Keep all files, versions and links;
// a standalone output, failed binding, renamed archive or ordinary upload stays visible.
func (r *Repository) projectBoundGeneratedAliases(projectID string) ([]string, error) {
	var archives []model.Asset
	if err := r.db.Table("assets").Select("assets.*").Joins("JOIN project_asset_links pal ON pal.asset_id = assets.id").Where("pal.project_id = ? AND assets.category = ? AND assets.title = ?", projectID, model.AssetCategoryMaterial, "生成图片").Scan(&archives).Error; err != nil {
		return nil, err
	}
	type archive struct{ id, taskID, resourceID string }
	var candidates []archive
	var taskIDs []string
	for _, asset := range archives {
		var payload struct {
			Metadata struct {
				Source string `json:"source"`
				TaskID string `json:"taskId"`
			} `json:"metadata"`
			Data struct {
				StorageKey string `json:"storageKey"`
			} `json:"data"`
		}
		if json.Unmarshal([]byte(asset.PayloadJSON), &payload) != nil || payload.Metadata.Source != "generation-task" || payload.Metadata.TaskID == "" {
			continue
		}
		key := payload.Data.StorageKey
		if len(key) <= len("resource:") || key[:len("resource:")] != "resource:" {
			continue
		}
		candidates = append(candidates, archive{asset.ID, payload.Metadata.TaskID, key[len("resource:"):]})
		taskIDs = append(taskIDs, payload.Metadata.TaskID)
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	var tasks []model.Task
	if err := r.db.Select("id", "input_json").Where("id IN ?", taskIDs).Find(&tasks).Error; err != nil {
		return nil, err
	}
	targets := map[string]string{}
	var targetIDs, resourceIDs []string
	for _, task := range tasks {
		var input struct {
			Metadata struct {
				Operation        string `json:"operation"`
				AssetID          string `json:"assetId"`
				CharacterAssetID string `json:"characterAssetId"`
			} `json:"metadata"`
		}
		if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
			continue
		}
		id := input.Metadata.AssetID
		if input.Metadata.Operation == "character_turnaround" && id == "" {
			id = input.Metadata.CharacterAssetID
		}
		if id == "" || (input.Metadata.Operation != "project_asset_image" && input.Metadata.Operation != "character_turnaround") {
			continue
		}
		targets[task.ID] = id
		targetIDs = append(targetIDs, id)
	}
	if len(targetIDs) == 0 {
		return nil, nil
	}
	for _, candidate := range candidates {
		resourceIDs = append(resourceIDs, candidate.resourceID)
	}
	var bindings []struct {
		AssetID    string
		ResourceID string
	}
	if err := r.db.Table("asset_representations ar").Select("av.asset_id, ar.resource_id").Joins("JOIN asset_versions av ON av.id = ar.asset_version_id").Joins("JOIN project_asset_links pal ON pal.asset_id = av.asset_id").Where("pal.project_id = ? AND av.asset_id IN ? AND ar.resource_id IN ?", projectID, targetIDs, resourceIDs).Scan(&bindings).Error; err != nil {
		return nil, err
	}
	bound := map[string]bool{}
	for _, binding := range bindings {
		bound[binding.AssetID+"\x00"+binding.ResourceID] = true
	}
	var hidden []string
	for _, candidate := range candidates {
		if bound[targets[candidate.taskID]+"\x00"+candidate.resourceID] {
			hidden = append(hidden, candidate.id)
		}
	}
	return hidden, nil
}
