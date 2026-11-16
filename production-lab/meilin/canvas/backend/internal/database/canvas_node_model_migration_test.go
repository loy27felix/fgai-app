package database

import (
	"encoding/json"
	"gorm.io/gorm"
	canvasdoc "meilin/backend/internal/canvas/document"
	"meilin/backend/internal/model"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestCanvasNodeMigrationPreservesSnapshotsUndoAndFGTimeline(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "node-model.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err = db.AutoMigrate(&model.CanvasProject{}, &model.CanvasSnapshot{}, &model.CloudAgentCanvasMutation{}); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 11, 1, 1, 2, 3, 0, time.UTC)
	before := `{"id":"c","nodes":[{"id":"m","type":"markdown","metadata":{"content":"# 剧本"}},{"id":"h","type":"html"}],"connections":[],"timeline":{"clips":[{"id":"audio"}]}}`
	after := `{"id":"c","nodes":[{"id":"m","type":"markdown","metadata":{"content":"# 剧本已改"}},{"id":"h","type":"html"}],"connections":[],"timeline":{"clips":[{"id":"audio"}]}}`
	hash := func(raw string) string {
		var d map[string]any
		_ = json.Unmarshal([]byte(raw), &d)
		return canvasdoc.SnapshotHash(d)
	}
	rows := []any{&model.CanvasProject{ID: "c", UserID: "owner", PayloadJSON: after, Revision: 4, CreatedAt: stamp, UpdatedAt: stamp}, &model.CanvasSnapshot{ID: "snapshot", CanvasID: "c", UserID: "owner", Revision: 3, PayloadJSON: before, PayloadBytes: len(before), CreatedAt: stamp}, &model.CloudAgentCanvasMutation{ID: "undo", UserID: "owner", CanvasID: "c", BeforeJSON: before, BeforeSnapshotHash: hash(before), AfterSnapshotHash: hash(after), Status: "applied", CreatedAt: stamp}}
	for _, row := range rows {
		if err = db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Transaction(migrateCanvasNodeModel); err != nil {
		t.Fatal(err)
	}
	var project model.CanvasProject
	var snapshot model.CanvasSnapshot
	var mutation model.CloudAgentCanvasMutation
	_ = db.First(&project, "id = ?", "c").Error
	_ = db.First(&snapshot, "id = ?", "snapshot").Error
	_ = db.First(&mutation, "id = ?", "undo").Error
	canonicalBefore, _, _ := canvasdoc.Canonicalize([]byte(before))
	canonicalAfter, _, _ := canvasdoc.Canonicalize([]byte(after))
	if project.Revision != 5 || !project.CreatedAt.Equal(stamp) || snapshot.Revision != 3 || !snapshot.CreatedAt.Equal(stamp) {
		t.Fatal("changed history identity or failed revision invalidation")
	}
	if snapshot.PayloadJSON != string(canonicalBefore) || snapshot.PayloadBytes != len(canonicalBefore) || mutation.BeforeSnapshotHash != hash(string(canonicalBefore)) || mutation.AfterSnapshotHash != hash(string(canonicalAfter)) || mutation.Status != "applied" {
		t.Fatalf("lost verified undo: %+v", mutation)
	}
	var doc map[string]any
	_ = json.Unmarshal([]byte(project.PayloadJSON), &doc)
	if doc["timeline"] == nil || doc["nodes"].([]any)[1].(map[string]any)["type"] != "html" {
		t.Fatal("lost FG editor data")
	}
	first := project
	if err = db.Transaction(migrateCanvasNodeModel); err != nil {
		t.Fatal(err)
	}
	_ = db.First(&project, "id = ?", "c").Error
	if !reflect.DeepEqual(first, project) {
		t.Fatal("repeat migration rewrote canvas")
	}
	// A damaged before-hash must roll back the whole transaction.
	if err = db.Model(&mutation).UpdateColumns(map[string]any{"before_json": before, "before_snapshot_hash": "unproven"}).Error; err != nil {
		t.Fatal(err)
	}
	err = db.Transaction(func(tx *gorm.DB) error { return migrateCanvasNodeModel(tx) })
	if err == nil {
		t.Fatal("fabricated undo authority for an unverified preimage")
	}
}
