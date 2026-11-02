package app

import (
	"encoding/json"
	"strings"
	"time"
	"yingce/backend/internal/model"
)

// Costumes are additional visuals of one character. Default identity, voices,
// historical versions and already rendered clips are preserved.
func (s *Service) finalizeCharacterCostumeTask(task model.Task, result map[string]interface{}) (bool, error) {
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return false, err
	}
	var input struct {
		Metadata struct {
			Operation      string `json:"operation"`
			AssetID        string `json:"characterAssetId"`
			Name           string `json:"costumeName"`
			Clothing       string `json:"costumeClothing"`
			BaseResourceID string `json:"costumeBaseResourceId"`
		} `json:"metadata"`
	}
	if err = json.Unmarshal([]byte(decrypted), &input); err != nil {
		return false, err
	}
	if input.Metadata.Operation != "character_costume" {
		return false, nil
	}
	if strings.TrimSpace(input.Metadata.Name) == "" || strings.TrimSpace(input.Metadata.Clothing) == "" {
		return false, BadAuthRequest("请填写服装名称和服装描述")
	}
	s.characterTaskMu.Lock()
	defer s.characterTaskMu.Unlock()
	bound, err := s.repo.AssetRepresentationsForTask(task.ID)
	if err != nil {
		return false, err
	}
	if len(bound) > 0 {
		return false, nil
	}
	asset, err := s.repo.ProjectCharacterAsset(task.UserID, task.ProjectID, input.Metadata.AssetID)
	if err != nil {
		return false, err
	}
	current, err := s.repo.AssetRepresentations(asset.PrimaryVersionID)
	if err != nil {
		return false, err
	}
	baseFound := false
	for _, rep := range current {
		if !strings.HasPrefix(rep.Role, "costume:") && rep.ResourceID == input.Metadata.BaseResourceID {
			baseFound = true
		}
	}
	if !baseFound {
		return false, BadAuthRequest("角色默认参考图已改变，换装图片已保留在任务中，请核对后手动绑定")
	}
	data, _ := json.Marshal(result)
	var output characterTurnaroundTaskResult
	if err = json.Unmarshal(data, &output); err != nil {
		return false, err
	}
	if len(output.Images) == 0 {
		return false, BadAuthRequest("换装任务没有返回图片")
	}
	resourceID := output.Images[0].ResourceID
	resource, err := s.repo.ResourceForUser(task.UserID, resourceID)
	if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return false, BadAuthRequest("换装图片尚未保存完成")
	}
	now := time.Now()
	operationID := newID()
	representations := make([]model.AssetRepresentation, 0, len(current)+1)
	for _, rep := range current {
		rep.ID = newID()
		rep.TaskID = operationID
		rep.CreatedAt = now
		representations = append(representations, rep)
	}
	if len(representations) >= 32 {
		return false, BadAuthRequest("角色造型数量已达上限，请先整理形象")
	}
	metadata, _ := json.Marshal(map[string]any{"name": strings.TrimSpace(input.Metadata.Name), "clothing": strings.TrimSpace(input.Metadata.Clothing), "source": "character_costume"})
	representations = append(representations, model.AssetRepresentation{ID: newID(), TaskID: task.ID, ResourceID: resourceID, MediaType: "image", Role: "costume:" + newID()[:24], MetadataJSON: string(metadata), CreatedAt: now})
	_, err = s.createNextCharacterVersion(task.ProjectID, asset, asset.Title, "", representations, nil, false)
	if err != nil {
		if saved, checkErr := s.repo.AssetRepresentationsForTask(task.ID); checkErr == nil && len(saved) > 0 {
			return false, nil
		}
	}
	return err == nil, err
}
