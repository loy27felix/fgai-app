package repository

import (
	"encoding/json"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"path/filepath"
	"testing"
	"time"
)

func TestDeletedCanvasArchivesOwnedAssetsButPreservesCrossOwnerReferences(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "archive.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err = db.AutoMigrate(&model.CanvasProject{}, &model.Asset{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range []model.Asset{
		{ID: "own", UserID: "alice", Status: "draft", PayloadJSON: `{"metadata":{"canvasId":"deleted"}}`},
		{ID: "shared", UserID: "alice", Status: "draft", PayloadJSON: `{"metadata":{"canvasId":"deleted"}}`},
		{ID: "foreign", UserID: "bob", Status: "draft", PayloadJSON: `{"metadata":{"canvasId":"deleted"}}`},
		{ID: "unrelated", UserID: "alice", Status: "draft", PayloadJSON: `{"metadata":{"canvasId":"other"}}`},
	} {
		if err = db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Create(&model.CanvasProject{ID: "remaining", UserID: "bob", PayloadJSON: `{"nodes":[{"metadata":{"assetId":"shared"}}]}`, UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Transaction(func(tx *gorm.DB) error { return archiveDeletedCanvasAssets(tx, "alice", "deleted") }); err != nil {
		t.Fatal(err)
	}
	var items []model.Asset
	if err = db.Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == "own" {
			var payload map[string]any
			json.Unmarshal([]byte(item.PayloadJSON), &payload)
			if item.Status != "archived" || payload["status"] != "archived" {
				t.Fatal("incremental deletion did not archive both representations")
			}
		} else if item.Status == "archived" {
			t.Fatal("archived a shared, foreign or unrelated asset", item.ID)
		}
	}
}
