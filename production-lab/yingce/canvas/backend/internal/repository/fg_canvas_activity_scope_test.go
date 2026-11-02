package repository

import (
	"errors"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"testing"
	"yingce/backend/internal/model"
)

func TestFGCanvasActivityExposesOnlyAuthorizedOccupancy(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "activity.sqlite")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.Task{}, &model.CloudAgentExecution{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE fg_story_projects(native_project_id TEXT PRIMARY KEY)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TABLE fg_accounts(user_id TEXT, email TEXT, platform_role TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO fg_story_projects VALUES ('shared-project')").Error; err != nil {
		t.Fatal(err)
	}
	for _, canvas := range []model.CanvasProject{{ID: "shared", UserID: "alice", ProjectID: "shared-project"}, {ID: "private", UserID: "alice"}} {
		if err := db.Create(&canvas).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Task{ID: "busy", UserID: "alice", ProjectID: "shared", Operation: "cloud_agent", Status: model.TaskStatusRunning}).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	activity, err := repo.CanvasAgentActivity("bob", "shared")
	if err != nil || activity == nil || activity.RunID != "busy" {
		t.Fatalf("shared occupancy unavailable: %+v %v", activity, err)
	}
	if _, err := repo.CanvasAgentActivity("bob", "private"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("private occupancy exposed: %v", err)
	}
	if err := repo.Transaction(func(tx *Repository) error { return tx.LockCanvasMutationForUser("bob", "private") }); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("private canvas lock granted: %v", err)
	}
	if err := repo.CreateTaskWithActiveLimit(&model.Task{ID: "second", UserID: "bob", ProjectID: "shared", Operation: "cloud_agent", Status: model.TaskStatusQueued}, 100); !errors.Is(err, ErrCanvasAgentBusy) {
		t.Fatalf("shared duplicate admitted: %v", err)
	}
}
