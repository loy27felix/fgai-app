package database

import (
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

// The explicitly supplied QA database is disposable. A private schema keeps
// this migration test separate even from other tests using that database.
func TestFGParityUpgradeFrom60Postgres(t *testing.T) {
	dsn := os.Getenv("FG_PARITY_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("disposable PostgreSQL not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, _ := base.DB()
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := fmt.Sprintf("parity_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error })
	testDSN, err := postgresDSNWithSearchPath(dsn, schema)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 60 {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Baseline migration uses current models; restore the production v60 shape.
	for _, statement := range []string{
		"DROP TABLE IF EXISTS canvas_edit_leases, user_feedbacks",
		"ALTER TABLE tasks DROP COLUMN agent_execution_ready",
		"ALTER TABLE model_channels DROP COLUMN catalog_provider_id",
		"ALTER TABLE channel_models DROP COLUMN catalog_model_key",
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	canvas := model.CanvasProject{ID: "keep-canvas", UserID: "owner", Title: "保留画布", PayloadJSON: `{"nodes":[{"id":"keep-node"}]}`, Revision: 9}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Table("tasks").Create(map[string]any{"id": "keep-task", "user_id": "owner", "project_id": canvas.ID, "operation": "cloud_agent", "status": "text_replay", "prompt": "preserved"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Table("cloud_agent_executions").Create(map[string]any{"id": "keep-task", "user_id": "owner", "status": "completed", "state_json": "{}"}).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	var after []schemaMigration
	if err := db.Where("version <= 60").Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("historical migration ledger changed")
	}
	var saved model.CanvasProject
	if err := db.First(&saved, "id = ?", canvas.ID).Error; err != nil || saved.PayloadJSON != canvas.PayloadJSON || saved.Revision != canvas.Revision {
		t.Fatalf("canvas changed: %v", err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", "keep-task").Error; err != nil || task.Prompt != "preserved" || task.Status != "text_replay" || !task.AgentExecutionReady {
		t.Fatalf("task changed or execution marker missing: %v", err)
	}
	for _, table := range []any{&model.CanvasEditLease{}, &model.UserFeedback{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table %T", table)
		}
	}
	for table, index := range map[string]string{"tasks": "idx_tasks_canvas_agent_reservation", "cloud_agent_executions": "idx_cloud_agent_canvas_active"} {
		if !db.Migrator().HasIndex(table, index) {
			t.Fatalf("missing index %s", index)
		}
	}
}
