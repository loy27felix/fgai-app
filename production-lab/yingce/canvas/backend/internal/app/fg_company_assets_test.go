package app

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"testing"
)

func TestFGCompanyLibraryPermissionsReuseAndRetirement(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	db := newSQLiteTestDB(t)
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{"CREATE TABLE fg_story_projects(native_project_id TEXT PRIMARY KEY)", "CREATE TABLE fg_resource_grants(project_id TEXT,resource_id TEXT,PRIMARY KEY(project_id,resource_id))", "CREATE TABLE fg_asset_grants(project_id TEXT,asset_id TEXT,PRIMARY KEY(project_id,asset_id))"} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := repository.New(db)
	svc := New(repo, t.TempDir())
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	member := &model.User{ID: "member", Role: model.UserRoleUser}
	resources := []model.Resource{{ID: "public-file", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "public.png", MimeType: "image/png", Size: 123, Width: 16, Height: 16}, {ID: "private-file", UserID: "other", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "private.png", MimeType: "image/png", Size: 456, Width: 16, Height: 16}}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	req := FGCompanyAssetInput{ResourceID: "public-file", Title: "贝瓦三视图", Category: "character", Brand: "贝瓦", Character: "贝瓦", Style: "羊毛毡", View: "三视图"}
	if _, err := svc.PublishFGCompanyAsset(member, req); err == nil {
		t.Fatal("member could publish")
	}
	forged := req
	forged.ResourceID = "private-file"
	if _, err := svc.PublishFGCompanyAsset(admin, forged); err == nil {
		t.Fatal("admin published another user's private file")
	}
	if _, err := repo.ResourceForUser(member.ID, "public-file"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("file shared before publication", err)
	}
	item, err := svc.PublishFGCompanyAsset(admin, req)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := svc.PublishFGCompanyAsset(admin, req)
	if err != nil || repeated.ID != item.ID {
		t.Fatal("publish retry created another entry", err)
	}
	page, err := svc.FGCompanyAssets(member, repository.FGCompanyAssetFilter{Kind: "image", Style: "羊毛毡", Page: 1, PageSize: 1})
	if err != nil || page.Total != 1 || page.Facets["brand"]["贝瓦"] != 1 {
		t.Fatalf("facets/page: %#v %v", page, err)
	}
	raw, err := svc.UseFGCompanyAsset(member, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	var asset struct {
		ID   string
		Data struct{ StorageKey string }
	}
	if err = json.Unmarshal(raw, &asset); err != nil {
		t.Fatal(err)
	}
	if asset.Data.StorageKey != "resource:public-file" {
		t.Fatalf("not a server resource: %s", raw)
	}
	reused, err := svc.UseFGCompanyAsset(member, item.ID)
	if err != nil || string(reused) != string(raw) {
		t.Fatal("reuse was not idempotent", err)
	}
	var n int64
	db.Model(&model.Resource{}).Count(&n)
	if n != 2 {
		t.Fatal("reuse duplicated physical resources", n)
	}
	if _, err = repo.ResourceForUser(member.ID, "private-file"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("private file leaked", err)
	}
	snapshots, err := repo.OtherAssetResourceReferences(admin.ID, nil)
	if err != nil || len(snapshots.Direct) != 1 || snapshots.Direct[0].Kind != "素材" {
		t.Fatal("company asset not protected from purge", err)
	}
	n, err = repo.ResourceStorageReferenceCount(&resources[0], []string{"public-file"})
	if err != nil || n < 1 {
		t.Fatal("physical object could be removed", n, err)
	}
	req.ExpectedRevision = 1
	req.Status = "archived"
	archived, err := svc.UpdateFGCompanyAsset(admin, item.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = svc.UpdateFGCompanyAsset(admin, item.ID, req); err == nil {
		t.Fatal("stale edit overwrote new revision")
	}
	page, err = svc.FGCompanyAssets(member, repository.FGCompanyAssetFilter{})
	if err != nil || page.Total != 0 {
		t.Fatal("retired asset listed", err)
	}
	if _, err = svc.UseFGCompanyAsset(member, item.ID); err == nil {
		t.Fatal("retired asset could be imported")
	}
	if _, err = repo.ResourceForUser(member.ID, "public-file"); err != nil {
		t.Fatal("retirement broke existing references", err)
	}
	req.ExpectedRevision = archived.Revision
	req.Status = "active"
	if _, err = svc.UpdateFGCompanyAsset(admin, item.ID, req); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "false")
	if _, err = svc.FGCompanyAssets(member, repository.FGCompanyAssetFilter{}); err == nil {
		t.Fatal("library leaked outside sixth module")
	}
}

func TestFGCompanyVoiceValidation(t *testing.T) {
	item := &model.FGCompanyAsset{Kind: "image"}
	if err := normalizeFGCompanyAsset(FGCompanyAssetInput{Title: "声线", Category: "voice"}, item); err == nil {
		t.Fatal("image accepted as voice")
	}
	item.Kind = "audio"
	if err := normalizeFGCompanyAsset(FGCompanyAssetInput{Title: "声线", Category: "voice", Style: "暖童声"}, item); err != nil {
		t.Fatal(err)
	}
}
