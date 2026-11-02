package repository

import (
	"errors"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestFGCanvasRecyclePreservesHistoryAndRejectsStaleSaves(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "recycle.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	handle, _ := db.DB()
	defer handle.Close()
	if err = db.AutoMigrate(&model.CanvasProject{}, &model.CanvasShare{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.CanvasEditLease{}); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{"CREATE TABLE fg_accounts(user_id TEXT PRIMARY KEY,platform_role TEXT)", "INSERT INTO fg_accounts VALUES('alice','user'),('bob','user'),('admin','superadmin'),('admin2','superadmin')", "CREATE TABLE fg_story_projects(native_project_id TEXT PRIMARY KEY)"} {
		if err = db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := New(db)
	original := model.CanvasProject{ID: "recover", UserID: "alice", Title: "保留节点", PayloadJSON: `{"nodes":[{"id":"node-1","type":"text"}],"connections":[{"id":"edge-1"}]}`, UpdatedAt: time.Now()}
	if err = repo.UpsertCanvasProject(&original); err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.CanvasSnapshot{ID: "history", CanvasID: original.ID, UserID: "alice", Revision: 1, PayloadJSON: original.PayloadJSON}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.CanvasSnapshotResource{SnapshotID: "history", ResourceID: "protected-media"}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.CanvasShare{ID: "public-link", UserID: "alice", ProjectID: original.ID, TokenHash: "hash", Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err = repo.DeleteCanvasProject("bob", original.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("foreign user deletion", err)
	}
	if err = repo.DeleteCanvasProject("admin", original.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CanvasProjectForUser("alice", original.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("deleted canvas remains visible", err)
	}
	if err = repo.UpsertCanvasProject(&original); !errors.Is(err, ErrCanvasRevisionConflict) {
		t.Fatal("stale tab resurrected document", err)
	}
	var kept model.CanvasProject
	if err = db.First(&kept, "id=?", original.ID).Error; err != nil || kept.PayloadJSON != original.PayloadJSON || kept.DeletedAt == nil || kept.DeletedBy != "admin" {
		t.Fatal("document not preserved", err)
	}
	for _, entity := range []any{&model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}} {
		var n int64
		if err = db.Model(entity).Count(&n).Error; err != nil || n != 1 {
			t.Fatal("history or media protection removed", err)
		}
	}
	var shares int64
	db.Model(&model.CanvasShare{}).Count(&shares)
	if shares != 0 {
		t.Fatal("public link remains active")
	}
	if rows, err := repo.FGRecycledCanvases("bob"); err != nil || len(rows) != 0 {
		t.Fatal("recycle leaked to member", err)
	}
	if rows, err := repo.FGRecycledCanvases("admin"); err != nil || len(rows) != 1 {
		t.Fatal("admin cannot view member recycle", err)
	}
	if err = repo.FGRestoreCanvas("bob", original.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("foreign restore", err)
	}
	if err = repo.FGRestoreCanvas("alice", original.ID); err != nil {
		t.Fatal(err)
	}
	recovered, err := repo.CanvasProjectForUser("alice", original.ID)
	if err != nil || recovered.PayloadJSON != original.PayloadJSON || recovered.Revision != 3 {
		t.Fatal("incorrect restore", err)
	}
	if err = repo.UpsertCanvasProject(&original); !errors.Is(err, ErrCanvasRevisionConflict) {
		t.Fatal("pre-delete revision accepted after restore", err)
	}
	protected := model.CanvasProject{ID: "protected-admin", UserID: "admin2", PayloadJSON: `{"nodes":[]}`}
	if err = repo.UpsertCanvasProject(&protected); err != nil {
		t.Fatal(err)
	}
	if err = repo.DeleteCanvasProject("admin2", protected.ID); err != nil {
		t.Fatal(err)
	}
	if rows, err := repo.FGRecycledCanvases("admin"); err != nil || len(rows) != 0 {
		t.Fatal("admin recycle leaked to other admin", err)
	}
	if err = repo.FGRestoreCanvas("admin", protected.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("admin recovered another admin canvas", err)
	}
}
