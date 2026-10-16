package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/model"
)

func TestFGIgnoreCandidatePreservesAssetsAndSuppressesRepeat(t *testing.T) {
	svc, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	candidate := model.ProjectAssetCandidate{ID: "ignored-prop", ProjectID: project.ID, UnitID: unit.ID, Name: "冰箱", NameKey: model.AssetCandidateNameKey("冰箱"), Category: model.AssetCategoryProp, Status: "pending_confirmation", DetailsJSON: "{}"}
	if err := db.Create(&candidate).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.IgnoreProjectAssetCandidate("other", project.ID, candidate.ID); err == nil {
		t.Fatal("private project accessible")
	}
	if err := svc.IgnoreProjectAssetCandidate("user-1", "other", candidate.ID); err == nil {
		t.Fatal("cross-project candidate accessible")
	}
	if err := svc.IgnoreProjectAssetCandidate("user-1", project.ID, candidate.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.IgnoreProjectAssetCandidate("user-1", project.ID, candidate.ID); err != nil {
		t.Fatal("retry not idempotent", err)
	}
	var saved model.ProjectAssetCandidate
	db.First(&saved, "id = ?", candidate.ID)
	if saved.Status != "ignored" || saved.DetailsJSON != "{}" {
		t.Fatalf("candidate = %+v", saved)
	}
	rows, err := svc.CreateProjectAssetCandidates("user-1", project.ID, CreateAssetCandidatesRequest{Candidates: []AssetCandidateInput{{Name: "冰箱", Category: "prop"}}})
	if err != nil || len(rows) != 0 {
		t.Fatalf("ignored candidate returned: %+v %v", rows, err)
	}
	db.Model(&candidate).Update("status", "confirmed")
	if err := svc.IgnoreProjectAssetCandidate("user-1", project.ID, candidate.ID); err == nil {
		t.Fatal("confirmed candidate ignored")
	}
}

func TestFGGeneratedAssetArchiveCoalescesOnlyExactSuccessfulBinding(t *testing.T) {
	svc, db := newProjectWorkflowV2TestService(t)
	project, _ := seedWorkflowProject(t, db)
	asset := model.Asset{ID: "prop", UserID: "user-1", Category: model.AssetCategoryProp, Kind: "image", Title: "披萨盒", PrimaryVersionID: "prop-v1", PayloadJSON: `{"data":{"storageKey":"resource:photo"}}`}
	for _, row := range []any{&asset, &model.AssetVersion{ID: "prop-v1", AssetID: asset.ID, Version: 1, DefinitionJSON: "{}"}, &model.ProjectAssetLink{ID: "prop-link", ProjectID: project.ID, AssetID: asset.ID}, &model.AssetRepresentation{ID: "prop-rep", TaskID: "prop-v1", AssetVersionID: "prop-v1", ResourceID: "photo", MediaType: "image"}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	inputs := []struct{ id, title, op, target, resource string }{
		{"duplicate", "生成图片", "project_asset_image", "prop", "photo"},
		{"failed-binding", "生成图片", "project_asset_image", "prop", "unbound"},
		{"independent", "生成图片", "canvas_image", "prop", "photo"},
		{"renamed", "我的自定义图片", "project_asset_image", "prop", "photo"},
		{"other-target", "生成图片", "project_asset_image", "other-project-prop", "photo"},
	}
	for _, input := range inputs {
		payload, _ := json.Marshal(map[string]any{"metadata": map[string]any{"source": "generation-task", "taskId": input.id}, "data": map[string]any{"storageKey": "resource:" + input.resource}})
		body, _ := json.Marshal(map[string]any{"metadata": map[string]any{"operation": input.op, "assetId": input.target}})
		for _, row := range []any{&model.Asset{ID: input.id, UserID: "user-1", Category: model.AssetCategoryMaterial, Kind: "image", Title: input.title, PayloadJSON: string(payload)}, &model.Task{ID: input.id, UserID: "user-1", ProjectID: project.ID, InputJSON: string(body)}, &model.ProjectAssetLink{ID: input.id + "-link", ProjectID: project.ID, AssetID: input.id}} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	assets, total, err := svc.repo.ProjectAssetsPage("user-1", project.ID, 1, 2, "", "", "", nil, "")
	if err != nil || total != 5 || len(assets) != 2 {
		t.Fatalf("page: %d %d %v", total, len(assets), err)
	}
	all, err := svc.repo.ProjectAssets("user-1", project.ID)
	if err != nil || len(all) != 5 {
		t.Fatalf("detail: %d %v", len(all), err)
	}
	for _, item := range all {
		if item.ID == "duplicate" {
			t.Fatal("duplicate remains visible")
		}
	}
	categories, folders, err := svc.repo.ProjectAssetFacets(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var categoryCount, folderCount int64
	for _, item := range categories {
		categoryCount += item.Count
	}
	for _, item := range folders {
		folderCount += item.Count
	}
	if categoryCount != 5 || folderCount != 5 {
		t.Fatalf("counts disagree: %d %d", categoryCount, folderCount)
	}
	var retained int64
	db.Model(&model.Asset{}).Count(&retained)
	if retained != 6 {
		t.Fatal("original assets were deleted")
	}
	// Historical versions still count as an exact binding after the primary version changes.
	db.Model(&asset).Update("primary_version_id", "prop-v2")
	_, total, err = svc.repo.ProjectAssetsPage("user-1", project.ID, 1, 20, "", "", "", nil, "")
	if err != nil || total != 5 {
		t.Fatal("history archive duplicated", total, err)
	}
	// Removing the structured link makes the preserved standalone output visible again.
	db.Where("project_id = ? AND asset_id = ?", project.ID, "prop").Delete(&model.ProjectAssetLink{})
	_, total, err = svc.repo.ProjectAssetsPage("user-1", project.ID, 1, 20, "", "", "", nil, "")
	if err != nil || total != 5 {
		t.Fatal("archive lost after unlink", total, err)
	}
}

func TestFGImportChaptersAppendsAfterEditedOrderWithoutReset(t *testing.T) {
	svc, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := db.Model(&unit).Updates(map[string]any{"title": "第九章 自己修改的标题", "source_text": "<p>已经修改好的剧本正文</p>", "position": 8}).Error; err != nil {
		t.Fatal(err)
	}
	imported, err := svc.ImportProjectUnits("user-1", project.ID, ImportProjectUnitsRequest{Units: []CreateProjectUnitRequest{{Title: "第 2 章", SourceText: "<p>新正文</p>"}}})
	if err != nil || len(imported) != 1 || imported[0].Position != 9 {
		t.Fatalf("import = %+v %v", imported, err)
	}
	var kept model.ProjectUnit
	if err := db.First(&kept, "id = ?", unit.ID).Error; err != nil {
		t.Fatal(err)
	}
	if kept.Title != "第九章 自己修改的标题" || kept.SourceText != "<p>已经修改好的剧本正文</p>" || kept.Position != 8 {
		t.Fatalf("existing chapter changed: %+v", kept)
	}
	imported, err = svc.ImportProjectUnits("user-1", project.ID, ImportProjectUnitsRequest{Units: []CreateProjectUnitRequest{{Title: "Chapter 12: Dawn", SourceText: "Next"}}})
	if err != nil || imported[0].Position != 10 || imported[0].Title != "Chapter 12: Dawn" {
		t.Fatalf("second append = %+v %v", imported, err)
	}
}
