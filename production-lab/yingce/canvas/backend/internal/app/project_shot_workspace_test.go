package app

import (
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestDuplicateShotKeepsOriginalAndCopiesOnlyScriptAndReferences(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	source, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "原镜头", Description: "人物站在桌前", DurationMs: 15000, Revision: ShotRevisionInput{VideoPrompt: "原提示词", Dialogue: "原台词"}})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, value := range []any{
		&model.Asset{ID: "a", UserID: "user-1", Kind: "image", Category: model.AssetCategoryProp, PrimaryVersionID: "v", Title: "道具", PayloadJSON: `{"data":{}}`},
		&model.AssetVersion{ID: "v", AssetID: "a", Version: 1, DefinitionJSON: `{}`},
		&model.ProjectAssetLink{ID: "pal", ProjectID: project.ID, AssetID: "a"},
		&model.ShotAssetReference{ID: "ref", ShotID: source.ID, AssetVersionID: "v", Role: "reference", Status: "linked", CreatedAt: now},
		&model.ShotArtifact{ID: "video-original", ProjectID: project.ID, UnitID: unit.ID, ShotID: source.ID, RevisionID: source.CurrentRevisionID, Type: "video", Version: 1, Status: "ready", Selected: true},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	copy, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{DuplicateOf: source.ID, Title: "原镜头 · 副本", Description: "人物站在桌前", DurationMs: 15000, Revision: ShotRevisionInput{VideoPrompt: "编辑后的副本", Dialogue: "原台词"}})
	if err != nil {
		t.Fatal(err)
	}
	if copy.ID == source.ID || copy.UnitID != unit.ID || copy.Position != source.Position+1 || copy.Status != "draft" {
		t.Fatalf("bad copy: %+v", copy)
	}
	var original model.Shot
	if err := db.First(&original, "id = ?", source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if original.CurrentRevisionID != source.CurrentRevisionID || original.Title != "原镜头" {
		t.Fatal("source was modified")
	}
	var refs []model.ShotAssetReference
	if err := db.Where("shot_id = ?", copy.ID).Find(&refs).Error; err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].ID == "ref" || refs[0].AssetVersionID != "v" {
		t.Fatalf("references not independently copied: %+v", refs)
	}
	var artifacts int64
	db.Model(&model.ShotArtifact{}).Where("shot_id = ?", copy.ID).Count(&artifacts)
	if artifacts != 0 {
		t.Fatal("copy must not pretend to have generated artifacts")
	}
	var originalVideo model.ShotArtifact
	db.First(&originalVideo, "id = ?", "video-original")
	if originalVideo.Status != "ready" || !originalVideo.Selected {
		t.Fatal("original video was invalidated")
	}
	var revision model.ShotRevision
	db.First(&revision, "id = ?", copy.CurrentRevisionID)
	if revision.VideoPrompt != "编辑后的副本" || revision.Dialogue != "原台词" {
		t.Fatal("copy did not preserve the editable snapshot")
	}
	if _, err := service.CreateProjectShot("another-user", project.ID, CreateProjectShotRequest{DuplicateOf: source.ID, Title: "非法"}); err == nil {
		t.Fatal("another user copied the source")
	}
	if _, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{ID: source.ID, DuplicateOf: source.ID, Title: "覆盖"}); err == nil {
		t.Fatal("duplicate overwrote a shot")
	}
}

func TestProjectMaterialsHaveChapterSourcesAndCanBeFilteredWithoutRenamingStoredAssets(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	for _, value := range []any{
		&model.ProjectUnit{ID: "unit-2", ProjectID: project.ID, Title: "第二章", Kind: model.ProjectUnitKindChapter},
		&model.Asset{ID: "a", UserID: "user-1", Kind: "video", Category: model.AssetCategoryMaterial, Title: "镜头01-镜头视频-v1", PrimaryVersionID: "v", PayloadJSON: `{"data":{"storageKey":"resource:video"}}`},
		&model.AssetVersion{ID: "v", AssetID: "a", Version: 1, DefinitionJSON: `{}`},
		&model.ProjectAssetLink{ID: "pal", ProjectID: project.ID, AssetID: "a"},
		&model.AssetRepresentation{ID: "ar", AssetVersionID: "v", TaskID: "task", Role: "output"},
		&model.ProductionTaskLink{ID: "ptl", ProjectID: project.ID, UnitID: unit.ID, ShotID: "s", TaskID: "task"},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	page, err := service.ProjectAssetsPage("user-1", project.ID, 1, 30, "", "", "", nil, "", unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Assets[0].SourceUnitID != unit.ID || page.Assets[0].Title != "第一章-镜头01-镜头视频-v1" {
		t.Fatalf("missing source: %+v", page)
	}
	other, err := service.ProjectAssetsPage("user-1", project.ID, 1, 30, "", "", "", nil, "", "unit-2")
	if err != nil || other.Total != 0 {
		t.Fatalf("wrong chapter results: %+v %v", other, err)
	}
	if _, err := service.ProjectAssetsPage("another-user", project.ID, 1, 30, "", "", "", nil, "", unit.ID); err == nil {
		t.Fatal("cross-user read")
	}
	var asset model.Asset
	db.First(&asset, "id = ?", "a")
	if asset.Title != "镜头01-镜头视频-v1" {
		t.Fatal("read path mutated stored name")
	}
}
