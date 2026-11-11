package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"meilin/backend/internal/kernel"
	"meilin/backend/internal/model"
)

// ImportLegacyDrama adds the production view to the SAME authorized project.
// Source rows and resources remain untouched; the transaction is the migration receipt.
func (r *Repository) ImportLegacyDrama(projectID, settings string) (bool, error) {
	imported := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var project model.Project
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&project, "id = ?", projectID).Error; err != nil {
			return err
		}
		var existing model.DramaProduction
		err := tx.First(&existing, "project_id = ?", projectID).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := time.Now().UTC()
		production := model.DramaProduction{ProjectID: projectID, UserID: project.UserID, Status: model.DramaStatusPaused, Stage: model.DramaStageProduce,
			SettingsJSON: settings, BibleJSON: `{}`, PlanDone: true, SampleApproved: true, Revision: 1,
			PauseReason: "旧版整项目已接续；请核对参考图、模型和分段，再手动继续制作", CreatedAt: now, UpdatedAt: now}
		if err := tx.Create(&production).Error; err != nil {
			return err
		}
		var chapters []model.ProjectUnit
		if err := tx.Where("project_id = ? AND kind = ?", projectID, "chapter").Order("position, id").Find(&chapters).Error; err != nil {
			return err
		}
		if len(chapters) == 0 {
			return kernel.BadAuthRequest("项目没有可接续的章节")
		}
		var assets []model.Asset
		if err := tx.Model(&model.Asset{}).Joins("JOIN project_asset_links l ON l.asset_id = assets.id").Where("l.project_id = ?", projectID).Order("assets.id").Find(&assets).Error; err != nil {
			return err
		}
		versions, costumes := map[string]model.DramaCast{}, map[string]model.DramaCast{}
		replace := []string{}
		for position, asset := range assets {
			kind := string(asset.Category)
			if kind != "character" && kind != "scene" && kind != "prop" {
				continue
			}
			root := model.DramaCast{ID: kernel.NewID(), ProjectID: projectID, Kind: kind, Name: asset.Title, Position: position, Revision: 1, Locked: true,
				AliasesJSON: `[]`, CreatedAt: now, UpdatedAt: now}
			var history []model.AssetVersion
			if err := tx.Where("asset_id = ?", asset.ID).Order("version, id").Find(&history).Error; err != nil {
				return err
			}
			for _, version := range history {
				cast := root
				cast.ImagePrompt, cast.Description = version.Prompt, version.DefinitionJSON
				// Pin non-current character versions as named looks, rather than replacing the actor's identity.
				if version.ID != asset.PrimaryVersionID && kind == "character" {
					cast.ID, cast.ParentID, cast.LookName = kernel.NewID(), root.ID, fmt.Sprintf("原版本 v%d", version.Version)
				}
				var voice model.CharacterVoiceBinding
				if err := tx.First(&voice, "asset_version_id = ?", version.ID).Error; err == nil {
					cast.VoiceProfileID, cast.VoiceInstructions = voice.VoiceProfileID, voice.Instructions
					var profile model.VoiceProfile
					if tx.First(&profile, "id = ?", voice.VoiceProfileID).Error == nil {
						cast.VoiceSampleResourceID = profile.SampleResourceID
					}
				} else if !errors.Is(err, gorm.ErrRecordNotFound) {
					return err
				}
				var representations []model.AssetRepresentation
				if err := tx.Where("asset_version_id = ? AND media_type = ?", version.ID, "image").Order("created_at, id").Find(&representations).Error; err != nil {
					return err
				}
				bestRank := -1
				for index, representation := range representations {
					if representation.ResourceID == "" {
						continue
					}
					owner := cast.ID
					if strings.HasPrefix(representation.Role, "costume:") && kind == "character" {
						look := cast
						look.ID, look.ParentID = kernel.NewID(), root.ID
						metadata := map[string]string{}
						_ = json.Unmarshal([]byte(representation.MetadataJSON), &metadata)
						look.LookName = metadata["name"]
						if look.LookName == "" {
							look.LookName = fmt.Sprintf("原服装 v%d-%d", version.Version, index+1)
						}
						look.Appearance = metadata["clothing"]
						look.ImageResourceID, look.ImageStatus, look.ImageVersion = representation.ResourceID, model.DramaMediaReady, version.Version
						if err := tx.Create(&look).Error; err != nil {
							return err
						}
						costumes[version.ID+":"+representation.Role] = look
						owner = look.ID
					} else {
						rank := 0
						switch representation.Role {
						case "turnaround_sheet", "turnaround":
							rank = 2
						case "primary":
							rank = 3
						case "front":
							rank = 1
						}
						if rank > bestRank {
							cast.ImageResourceID, cast.ImageStatus, cast.ImageVersion = representation.ResourceID, model.DramaMediaReady, version.Version
							bestRank = rank
						}
					}
					take := model.DramaTake{ID: kernel.NewID(), ProjectID: projectID, OwnerID: owner, Kind: "cast", Version: version.Version*100 + index,
						ResourceID: representation.ResourceID, TaskID: representation.TaskID, Prompt: version.Prompt, CreatedAt: representation.CreatedAt}
					if err := tx.Create(&take).Error; err != nil {
						return err
					}
				}
				versions[version.ID] = cast
				if cast.ParentID != "" {
					if err := tx.Create(&cast).Error; err != nil {
						return err
					}
				}
				if version.ID == asset.PrimaryVersionID {
					root = cast
				}
			}
			if err := tx.Create(&root).Error; err != nil {
				return err
			}
			replace = append(replace, asset.ID, root.ID)
		}
		replacer := strings.NewReplacer(replace...)
		for index, chapter := range chapters {
			ids, _ := json.Marshal([]string{chapter.ID})
			episode := model.DramaEpisode{ID: kernel.NewID(), ProjectID: projectID, Number: index + 1, Title: chapter.Title, SourceFormat: model.DramaSourceStoryboard,
				ChapterIDsJSON: string(ids), Stage: model.DramaEpisodeReview, Revision: 1, CreatedAt: now, UpdatedAt: now}
			var shots []model.Shot
			if err := tx.Where("project_id = ? AND unit_id = ?", projectID, chapter.ID).Order("position, id").Find(&shots).Error; err != nil {
				return err
			}
			if len(shots) == 0 {
				episode.Stage = model.DramaEpisodeQueued
				episode.SourceFormat = model.DramaSourceScript
			}
			if err := tx.Create(&episode).Error; err != nil {
				return err
			}
			for n, old := range shots {
				var revision model.ShotRevision
				if old.CurrentRevisionID != "" {
					if err := tx.First(&revision, "id = ? AND shot_id = ?", old.CurrentRevisionID, old.ID).Error; err != nil {
						return err
					}
				}
				castIDs, lookIDs, propIDs, refs := []string{}, []string{}, []string{}, []string{}
				sceneID := ""
				var links []model.ShotAssetReference
				if err := tx.Where("shot_id = ?", old.ID).Order("created_at, id").Find(&links).Error; err != nil {
					return err
				}
				for _, link := range links {
					cast, found := versions[link.AssetVersionID]
					if look, exists := costumes[link.AssetVersionID+":"+link.Role]; exists {
						cast, found = look, true
					}
					if !found {
						continue
					}
					refs = append(refs, cast.ID)
					switch cast.Kind {
					case "character":
						id := cast.ID
						if cast.ParentID != "" {
							id = cast.ParentID
							lookIDs = append(lookIDs, cast.ID)
						}
						castIDs = append(castIDs, id)
					case "scene":
						sceneID = cast.ID
					case "prop":
						propIDs = append(propIDs, cast.ID)
					}
				}
				encode := func(v any) string { b, _ := json.Marshal(v); return string(b) }
				duration := revision.DurationMs
				if duration <= 0 {
					duration = old.DurationMs
				}
				shot := model.DramaShot{ID: kernel.NewID(), ProjectID: projectID, EpisodeID: episode.ID, Position: n, SegmentIndex: n, SegmentTitle: old.Title,
					SceneCastID: sceneID, CastIDsJSON: encode(castIDs), LookCastIDsJSON: encode(lookIDs), PropIDsJSON: encode(propIDs),
					Dialogue: revision.Dialogue, Action: revision.Action, ShotSize: revision.ShotSize, Camera: revision.CameraMovement,
					DurationMs: duration, ImagePrompt: replacer.Replace(revision.ImagePrompt), VideoPrompt: replacer.Replace(revision.VideoPrompt), SourceQuote: revision.PlotDescription, CreatedAt: now, UpdatedAt: now}
				if err := tx.Create(&shot).Error; err != nil {
					return err
				}
				segment := model.DramaSegment{ID: kernel.NewID(), ProjectID: projectID, EpisodeID: episode.ID, SegmentIndex: n,
					VideoPrompt: shot.VideoPrompt, VideoPromptOverride: shot.VideoPrompt, ReferenceCastIDsJSON: encode(refs), Revision: 1,
					VideoSeconds: int((duration + 999) / 1000), PromptSeconds: int((duration + 999) / 1000), CreatedAt: now, UpdatedAt: now}
				if shot.VideoPrompt != "" {
					segment.PromptStatus = model.DramaMediaReady
				}
				var artifacts []model.ShotArtifact
				if err := tx.Where("shot_id = ? AND resource_id <> ?", old.ID, "").Order("version, id").Find(&artifacts).Error; err != nil {
					return err
				}
				for _, artifact := range artifacts {
					if artifact.Type != "shot_video" && artifact.Type != "video" {
						continue
					}
					take := model.DramaTake{ID: kernel.NewID(), ProjectID: projectID, OwnerID: segment.ID, Kind: "video", Version: artifact.Version,
						ResourceID: artifact.ResourceID, TaskID: artifact.TaskID, Prompt: shot.VideoPrompt, DurationMs: duration, CreatedAt: artifact.CreatedAt}
					if err := tx.Create(&take).Error; err != nil {
						return err
					}
					if artifact.Selected {
						segment.VideoResourceID, segment.VideoStatus = artifact.ResourceID, model.DramaMediaReady
					}
				}
				if err := tx.Create(&segment).Error; err != nil {
					return err
				}
				episode.DurationMs += duration
			}
			if err := tx.Model(&episode).Updates(map[string]any{"shot_count": len(shots), "duration_ms": episode.DurationMs}).Error; err != nil {
				return err
			}
		}
		imported = true
		return nil
	})
	return imported, err
}
