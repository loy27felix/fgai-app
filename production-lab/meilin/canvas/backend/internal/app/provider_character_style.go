package app

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Style sheets can contain protagonist portraits. They must never become an implicit
// identity reference for a different character, even if a stale client sends them.
func (s *Service) isolateCharacterStyleIdentity(userID, taskProjectID string, profile *styleProfileDocument, input *canvasGenerationInput) error {
	targetID := metadataString(input.Metadata, "characterAssetId")
	if input.Mode != "image" || targetID == "" {
		return nil
	}
	projectID := taskProjectID
	if canvas, err := s.repo.CanvasProjectForUser(userID, taskProjectID); err == nil && canvas.ProjectID != "" {
		projectID = canvas.ProjectID
	}
	target, err := s.repo.ProjectCharacterAsset(userID, projectID, targetID)
	if err != nil {
		return fmt.Errorf("角色身份校验失败：%w", err)
	}
	identities, err := s.repo.ProjectCharacterResourceIdentities(projectID)
	if err != nil {
		return err
	}
	explicit := map[string]bool{}
	encoded, _ := json.Marshal(input.Metadata["characterIdentityReferenceIds"])
	var explicitIDs []string
	if json.Unmarshal(encoded, &explicitIDs) == nil {
		for _, id := range explicitIDs {
			explicit[id] = true
		}
	}
	other := map[string]string{}
	own := map[string]bool{}
	for _, identity := range identities {
		if identity.AssetID == targetID {
			own[identity.ResourceID] = true
		} else {
			other[identity.ResourceID] = identity.Title
		}
	}
	excluded := map[string]string{}
	for i := range profile.Assets {
		asset := &profile.Assets[i]
		if asset.Kind != "reference" {
			continue
		}
		kept := make([]string, 0, len(asset.ReferenceResourceIDs))
		for _, id := range asset.ReferenceResourceIDs {
			if name := other[id]; name != "" && !own[id] && !explicit[id] {
				excluded[id] = name
			} else {
				kept = append(kept, id)
			}
		}
		asset.ReferenceResourceIDs = kept
	}
	keptImages := input.ReferenceImages[:0]
	for _, image := range input.ReferenceImages {
		id := strings.TrimPrefix(image.StorageKey, "resource:")
		if excluded[id] != "" {
			continue
		}
		keptImages = append(keptImages, image)
	}
	input.ReferenceImages = keptImages
	if len(excluded) > 0 {
		input.Metadata["excludedCharacterStyleReferences"] = excluded
	}
	input.Prompt += "\n\n【当前角色独立身份】\n本次资产唯一主体：" + target.Title + "。项目画风里其他角色的名称、外貌和服装只是背景资料，不是本角色。不得把主角或其他角色换名后复制为本角色。保留本角色已确认的性别、年龄、物种、外貌及服装；尚未明确的外观应设计为可辨认的独立人物，不编造亲属或同一人关系。"
	return nil
}
