package repository

import (
	"errors"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"meilin/backend/internal/assets"
	"meilin/backend/internal/model"
	"path/filepath"
	"testing"
	"time"
)

func TestFGCanvasPurgeRetainsNASMediaAndEnforcesOwnerAndExpiry(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "purge.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	h, _ := db.DB()
	defer h.Close()
	if err = db.AutoMigrate(&model.CanvasProject{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.Task{}, &model.CloudAgentExecution{}); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"CREATE TABLE fg_accounts(user_id TEXT PRIMARY KEY,platform_role TEXT)", "INSERT INTO fg_accounts VALUES('alice','user'),('bob','user'),('admin','superadmin'),('admin2','superadmin')"} {
		if err = db.Exec(q).Error; err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	expired := now.Add(-31 * 24 * time.Hour)
	resourceID := "12345678901234567890123456789012"
	canvas := model.CanvasProject{ID: "canvas", UserID: "alice", Title: "归档工程", PayloadJSON: `{"nodes":[{"content":"resource:` + resourceID + `"}]}`, Revision: 9, DeletedAt: &expired}
	if err = db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	history := model.CanvasSnapshot{ID: "history", CanvasID: canvas.ID, UserID: canvas.UserID, Revision: 8, PayloadJSON: `{"nodes":[{"id":"old-node"}]}`}
	if err = db.Create(&history).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	calls := 0
	var saved FGCanvasRecycleArchive
	archive := func(bundle FGCanvasRecycleArchive) error { calls++; saved = bundle; return nil }
	for _, actor := range []string{"bob", "admin2"} {
		// Another administrator's private document remains isolated.
		if actor == "admin2" {
			db.Model(&canvas).Update("user_id", "admin")
		}
		if err = repo.FGPurgeCanvas(actor, canvas.ID, nil, archive); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatal("foreign purge", actor, err)
		}
	}
	db.Model(&canvas).Update("user_id", "alice")
	if calls != 0 {
		t.Fatal("unauthorized archive written")
	}
	nasDown := errors.New("NAS unavailable")
	if err = repo.FGPurgeCanvas("alice", canvas.ID, nil, func(FGCanvasRecycleArchive) error { return nasDown }); !errors.Is(err, nasDown) {
		t.Fatal(err)
	}
	var retained model.CanvasProject
	db.First(&retained, "id=?", canvas.ID)
	if retained.PurgedAt != nil || retained.PayloadJSON != canvas.PayloadJSON {
		t.Fatal("failed NAS removed document")
	}
	db.Create(&model.CloudAgentExecution{ID: "active-agent", CanvasID: canvas.ID, Status: "running"})
	if err = repo.FGPurgeCanvas("admin", canvas.ID, nil, archive); err == nil {
		t.Fatal("running Agent purged")
	}
	db.Delete(&model.CloudAgentExecution{}, "id=?", "active-agent")
	if err = repo.FGPurgeCanvas("admin", canvas.ID, nil, archive); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || saved.Canvas.PayloadJSON != canvas.PayloadJSON || len(saved.History) != 1 || saved.History[0].PayloadJSON != history.PayloadJSON {
		t.Fatal("incomplete NAS archive")
	}
	db.First(&retained, "id=?", canvas.ID)
	if retained.PurgedAt == nil || retained.Revision != 10 || !assets.DocumentReferences(retained.PayloadJSON, map[string]struct{}{resourceID: {}}) {
		t.Fatal("tombstone or media pins missing", retained)
	}
	if err = repo.FGPurgeCanvas("alice", canvas.ID, nil, archive); err != nil || calls != 1 {
		t.Fatal("purge not idempotent", err)
	}
	if err = repo.FGRestoreCanvas("alice", canvas.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("purged canvas restored", err)
	}
	rows, err := repo.FGRecycledCanvases("admin")
	if err != nil || len(rows) != 0 {
		t.Fatal("purged canvas visible", err)
	}
	canvas.ID = "fresh"
	canvas.PurgedAt = nil
	canvas.DeletedAt = &now
	db.Create(&canvas)
	cutoff := now.Add(-30 * 24 * time.Hour)
	if err = repo.FGPurgeCanvas("", canvas.ID, &cutoff, archive); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("fresh document automatically purged", err)
	}
	canvas.ID = "restored"
	canvas.DeletedAt = &expired
	db.Create(&canvas)
	if err = repo.FGRestoreCanvas("alice", canvas.ID); err != nil {
		t.Fatal(err)
	}
	if err = repo.FGPurgeCanvas("", canvas.ID, &cutoff, archive); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("restored document purged", err)
	}
}
