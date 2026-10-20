package app

import (
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func TestProjectAssetHistoryKeepsPreviousImagesAndChecksAccess(t *testing.T) {
	svc, db := newProjectAssetLinkTestService(t)
	project := model.Project{ID: "project", UserID: "user-1", Name: "test", Status: model.ProjectStatusActive}
	asset := model.Asset{ID: "asset", UserID: "user-1", Title: "角色", Kind: "image", PrimaryVersionID: "v2"}
	records := []any{&project, &asset,
		&model.ProjectAssetLink{ID: "link", ProjectID: project.ID, AssetID: asset.ID},
		&model.AssetVersion{ID: "v1", AssetID: asset.ID, Version: 1}, &model.AssetVersion{ID: "v2", AssetID: asset.ID, Version: 2},
		&model.Resource{ID: "old-image", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "new-image", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "private-image", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
		&model.AssetRepresentation{ID: "old", TaskID: "task-old", AssetVersionID: "v1", ResourceID: "old-image", MediaType: "image", Role: "primary"},
		&model.AssetRepresentation{ID: "new", TaskID: "task-new", AssetVersionID: "v2", ResourceID: "new-image", MediaType: "image", Role: "primary"},
		&model.AssetRepresentation{ID: "duplicate", AssetVersionID: "v2", ResourceID: "new-image", MediaType: "image", Role: "turnaround_sheet"},
		&model.AssetRepresentation{ID: "private", AssetVersionID: "v2", ResourceID: "private-image", MediaType: "image", Role: "detail"},
	}
	for _, record := range records {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	images, err := svc.ProjectAssetHistoryImages("user-1", project.ID, asset.ID)
	if err != nil || len(images) != 2 {
		t.Fatalf("history: %+v %v", images, err)
	}
	if images[0].Version != 2 || images[1].ResourceID != "old-image" {
		t.Fatalf("previous version lost: %+v", images)
	}
	if _, err := svc.ProjectAssetHistoryImages("other", project.ID, asset.ID); err == nil {
		t.Fatal("cross-user history allowed")
	}
	if err := db.Where("id = ?", "link").Delete(&model.ProjectAssetLink{}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ProjectAssetHistoryImages("user-1", project.ID, asset.ID); err == nil {
		t.Fatal("unlinked asset history allowed")
	}
}

func TestTaskClientContextExposesAssetLinkWithoutPrivateInputs(t *testing.T) {
	ctx := taskClientContext(`{"metadata":{"operation":"project_asset_image","assetId":"asset","source":"project-asset-batch","secret":"private"},"config":{"apiKey":"never-expose"}}`)
	if ctx == nil || ctx.AssetID != "asset" {
		t.Fatalf("missing asset context: %+v", ctx)
	}
	if ctx := taskClientContext(`{"metadata":{"operation":"unrelated","assetId":"asset"}}`); ctx != nil {
		t.Fatal("unrelated task exposed asset context")
	}
}

func TestProjectOrdinaryImageCanRestoreHistoryWithoutLosingPrompt(t *testing.T) {
	svc, db := newProjectAssetLinkTestService(t)
	for _, record := range []any{
		&model.Project{ID: "p", UserID: "user-1", Status: model.ProjectStatusActive},
		&model.Asset{ID: "a", UserID: "user-1", Kind: "image", Category: "material", Title: "生成图片", PrimaryVersionID: "v1", PayloadJSON: `{"data":{"content":"original prompt","storageKey":"resource:current"}}`},
		&model.AssetVersion{ID: "v1", AssetID: "a", Version: 1, DefinitionJSON: `{}`},
		&model.ProjectAssetLink{ID: "l", ProjectID: "p", AssetID: "a"},
		&model.Resource{ID: "old", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Width: 512, Height: 512},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := svc.UpdateProjectAssetVisual("user-1", "p", "a", UpdateProjectAssetVisualRequest{ResourceID: "old", VersionID: "v1"})
	if err != nil || result.StorageKey != "resource:old" || result.VersionCount != 2 {
		t.Fatalf("restore: %+v %v", result, err)
	}
	asset, err := svc.repo.AssetForUser("user-1", "a")
	if err != nil || !strings.Contains(asset.PayloadJSON, "original prompt") {
		t.Fatalf("prompt lost: %+v %v", asset, err)
	}
}
