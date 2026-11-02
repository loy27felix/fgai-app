package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func TestCharacterRepresentationSummaryOnlyReturnsCostumeLabels(t *testing.T) {
	input := model.AssetRepresentation{Role: "primary", MetadataJSON: `{"prompt":"unrelated long generation record","name":"default"}`}
	if characterRepresentationSummary(input).Metadata != nil {
		t.Fatal("default visual exposes unrelated generation metadata")
	}
	input.Role = "costume:night"
	input.MetadataJSON = `{"name":"夜景","clothing":"风衣","prompt":"not needed by wardrobe UI"}`
	value := characterRepresentationSummary(input)
	if len(value.Metadata) != 2 || value.Metadata["clothing"] != "风衣" {
		t.Fatal("costume projection must expose only labels")
	}
}

func TestCharacterCostumePreservesDefaultAndBindsPerShotAtomically(t *testing.T) {
	s, db := newProjectWorkflowV2TestService(t)
	if err := db.AutoMigrate(&model.VoiceProfile{}); err != nil {
		t.Fatal(err)
	}
	project, unit := seedWorkflowProject(t, db)
	character, err := s.CreateProjectCharacter("user-1", project.ID, CreateProjectCharacterRequest{Name: "男调查员", Definition: map[string]any{"gender": "男性"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"default-image", "new-costume", "replaced-default"} {
		if err = db.Create(&model.Resource{ID: id, UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	character, err = s.ReplaceProjectCharacterRepresentations("user-1", project.ID, character.Asset.ID, ReplaceCharacterRepresentationsRequest{Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: "default-image"}, {Role: "turnaround_sheet", ResourceID: "default-image"}}})
	if err != nil {
		t.Fatal(err)
	}
	oldVersion := character.Character.VersionID
	task := model.Task{ID: "costume-task", UserID: "user-1", ProjectID: project.ID}
	input, _ := json.Marshal(map[string]any{"metadata": map[string]any{"operation": "character_costume", "characterAssetId": character.Asset.ID, "costumeName": "雨夜外套", "costumeClothing": "深蓝风衣", "costumeBaseResourceId": "default-image"}})
	task.InputJSON = string(input)
	result := map[string]interface{}{"images": []map[string]string{{"resourceId": "new-costume"}}}
	if changed, err := s.finalizeCharacterCostumeTask(task, result); err != nil || !changed {
		t.Fatalf("finalize: %v %v", changed, err)
	}
	if changed, err := s.finalizeCharacterCostumeTask(task, result); err != nil || changed {
		t.Fatalf("duplicate finalize: %v %v", changed, err)
	}
	latest, err := s.ProjectCharacter("user-1", project.ID, character.Asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	var role string
	for _, rep := range latest.Character.Representations {
		if rep.ResourceID == "new-costume" {
			role = rep.Role
			if rep.Metadata["name"] != "雨夜外套" {
				t.Fatal("costume label lost")
			}
		}
	}
	if role == "" || len(latest.Character.Representations) != 3 {
		t.Fatal("default visual was replaced by costume")
	}
	if len(role) > 32 || !validShotAssetRole(role) || !validCharacterRepresentationRole(role) {
		t.Fatal("costume role exceeds PostgreSQL field contract")
	}
	shot, err := s.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "镜头01", Description: "调查员推门进入", DurationMs: 13000})
	if err != nil {
		t.Fatal(err)
	}
	ref, err := s.LinkShotAsset("user-1", project.ID, shot.ID, LinkShotAssetRequest{AssetVersionID: oldVersion, Role: "reference"})
	if err != nil {
		t.Fatal(err)
	}
	replaced, err := s.LinkShotAsset("user-1", project.ID, shot.ID, LinkShotAssetRequest{AssetVersionID: latest.Character.VersionID, Role: role, ReplaceReferenceID: ref.ID})
	if err != nil {
		t.Fatal(err)
	}
	if replaced.ID != ref.ID {
		t.Fatal("reference order was changed")
	}
	var count int64
	db.Model(&model.ShotAssetReference{}).Where("shot_id = ?", shot.ID).Count(&count)
	if count != 1 {
		t.Fatal("duplicate face references")
	}
	if _, err = s.LinkShotAsset("user-2", project.ID, shot.ID, LinkShotAssetRequest{AssetVersionID: latest.Character.VersionID, Role: role, ReplaceReferenceID: ref.ID}); err == nil {
		t.Fatal("other user changed costume")
	}
	if _, err = s.LinkShotAsset("user-1", project.ID, shot.ID, LinkShotAssetRequest{AssetVersionID: oldVersion, Role: role, ReplaceReferenceID: ref.ID}); err == nil {
		t.Fatal("costume from another version accepted")
	}
	if _, err = s.ReplaceProjectCharacterRepresentations("user-1", project.ID, character.Asset.ID, ReplaceCharacterRepresentationsRequest{ExpectedVersionID: oldVersion, Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: "replaced-default"}}}); err == nil {
		t.Fatal("stale image write accepted")
	}
	after, err := s.ReplaceProjectCharacterRepresentations("user-1", project.ID, character.Asset.ID, ReplaceCharacterRepresentationsRequest{ExpectedVersionID: latest.Character.VersionID, Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: "replaced-default"}, {Role: "turnaround_sheet", ResourceID: "replaced-default"}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Character.Representations) != 3 {
		t.Fatal("default replacement discarded costumes")
	}
	task.ID = "costume-after-default-change"
	if _, err = s.finalizeCharacterCostumeTask(task, result); err == nil {
		t.Fatal("background costume silently rebound after base identity changed")
	}
}
