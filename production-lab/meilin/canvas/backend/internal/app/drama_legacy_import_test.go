package app

import (
	"meilin/backend/internal/model"
	"testing"
)

func TestLegacyDramaImportKeepsSourceMediaAndIsIdempotent(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	for _, row := range []any{
		&model.Project{ID: "legacy", UserID: "user", Name: "Original", Status: model.ProjectStatusActive, AspectRatio: "9:16"},
		&model.ProjectUnit{ID: "chapter", ProjectID: "legacy", Kind: "chapter", Title: "Episode 7", SourceText: "Keep this original dialogue."},
		&model.Asset{ID: "hero", UserID: "user", Category: "character", Title: "Actor", PrimaryVersionID: "v2"},
		&model.ProjectAssetLink{ID: "link", ProjectID: "legacy", AssetID: "hero"},
		&model.AssetVersion{ID: "v1", AssetID: "hero", Version: 1, DefinitionJSON: `{"name":"Actor"}`},
		&model.AssetVersion{ID: "v2", AssetID: "hero", Version: 2, DefinitionJSON: `{"name":"Actor"}`},
		&model.AssetRepresentation{ID: "image", AssetVersionID: "v2", ResourceID: "portrait", MediaType: "image", Role: "turnaround"},
		&model.AssetRepresentation{ID: "costume", AssetVersionID: "v2", ResourceID: "night-coat", MediaType: "image", Role: "costume:night", MetadataJSON: `{"name":"夜间外套","clothing":"蓝色外套"}`},
		&model.Shot{ID: "shot", ProjectID: "legacy", UnitID: "chapter", Title: "shot01", CurrentRevisionID: "revision", DurationMs: 15000},
		&model.ShotRevision{ID: "revision", ShotID: "shot", Version: 1, Dialogue: "Keep this original dialogue.", VideoPrompt: "Actor @[asset:hero] enters.", DurationMs: 15000},
		&model.ShotAssetReference{ID: "ref", ShotID: "shot", AssetVersionID: "v2", Role: "character"},
		&model.ShotArtifact{ID: "video1", ProjectID: "legacy", UnitID: "chapter", ShotID: "shot", Type: "video", Version: 1, ResourceID: "original-video", Selected: true},
		&model.ShotArtifact{ID: "video2", ProjectID: "legacy", UnitID: "chapter", ShotID: "shot", Type: "video", Version: 2, ResourceID: "other-video"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.ImportLegacyDrama("other", "legacy"); err == nil {
		t.Fatal("cross-user migration accepted")
	}
	first, err := svc.ImportLegacyDrama("user", "legacy")
	if err != nil || first["imported"] != true {
		t.Fatalf("import=%v %v", first, err)
	}
	second, err := svc.ImportLegacyDrama("user", "legacy")
	if err != nil || second["imported"] != false {
		t.Fatalf("replay=%v %v", second, err)
	}
	var production model.DramaProduction
	if err := db.First(&production, "project_id = ?", "legacy").Error; err != nil || production.Status != model.DramaStatusPaused {
		t.Fatalf("production=%+v %v", production, err)
	}
	var shots []model.DramaShot
	if err := db.Where("project_id = ?", "legacy").Find(&shots).Error; err != nil || len(shots) != 1 || shots[0].Dialogue != "Keep this original dialogue." {
		t.Fatalf("shots=%+v %v", shots, err)
	}
	var segment model.DramaSegment
	if err := db.First(&segment, "project_id = ?", "legacy").Error; err != nil || segment.VideoResourceID != "original-video" {
		t.Fatalf("segment=%+v %v", segment, err)
	}
	var actor model.DramaCast
	if err := db.First(&actor, "project_id = ? AND parent_id = ?", "legacy", "").Error; err != nil || actor.ImageResourceID != "portrait" {
		t.Fatalf("default image overwritten by costume: %+v %v", actor, err)
	}
	var look model.DramaCast
	if err := db.First(&look, "project_id = ? AND look_name = ?", "legacy", "夜间外套").Error; err != nil || look.ImageResourceID != "night-coat" || look.ParentID != actor.ID {
		t.Fatalf("costume lost: %+v %v", look, err)
	}
	var takes int64
	if err := db.Model(&model.DramaTake{}).Where("project_id = ? AND kind = ?", "legacy", "video").Count(&takes).Error; err != nil || takes != 2 {
		t.Fatalf("takes=%d %v", takes, err)
	}
	var old model.ShotRevision
	if err := db.First(&old, "id = ?", "revision").Error; err != nil || old.VideoPrompt != "Actor @[asset:hero] enters." {
		t.Fatal("source changed", err)
	}
	var jobs int64
	if err := db.Model(&model.DramaJob{}).Where("project_id = ?", "legacy").Count(&jobs).Error; err != nil || jobs != 0 {
		t.Fatal("migration queued paid work", err)
	}
}

func TestLegacyDramaImportRollsBackWithoutChapters(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	if err := db.Create(&model.Project{ID: "empty", UserID: "user", Name: "empty", Status: model.ProjectStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ImportLegacyDrama("user", "empty"); err == nil {
		t.Fatal("empty import accepted")
	}
	var count int64
	if err := db.Model(&model.DramaProduction{}).Where("project_id = ?", "empty").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("partial migration persisted", err)
	}
}
