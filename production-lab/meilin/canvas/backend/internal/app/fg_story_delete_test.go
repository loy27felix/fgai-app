package app

import (
	"meilin/backend/internal/model"
	"os"
	"path/filepath"
	"testing"
)

func TestFGStoryDeleteArchivesAndReleasesSelection(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	s, db := newProjectDeleteTestService(t)
	root := t.TempDir()
	t.Setenv("CANVAS_FG_NAS_ROOT", root)
	if err := os.Mkdir(filepath.Join(root, "media"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "media", ".fg-studio-nas-ready"), []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"PRAGMA foreign_keys=ON",
		"CREATE TABLE fg_accounts(user_id TEXT PRIMARY KEY,platform_role TEXT)",
		"INSERT INTO fg_accounts VALUES('admin','superadmin'),('member','member')",
		"CREATE TABLE fg_story_projects(id TEXT,user_id TEXT,topic_id INTEGER,native_project_id TEXT REFERENCES projects(id),archived_at DATETIME)",
	} {
		if err := db.Exec(q).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Project{ID: "story-delete", UserID: "admin", Name: "test story", Type: "short-drama", Status: model.ProjectStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO fg_story_projects VALUES('link','admin',23,'story-delete',NULL)").Error; err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteProject("admin", "story-delete"); err != nil {
		t.Fatalf("story deletion must preserve its FK and archive before releasing selection: %v", err)
	}
	var active int64
	if err := db.Table("fg_story_projects").Where("archived_at IS NULL").Count(&active).Error; err != nil || active != 0 {
		t.Fatalf("selection still active: %d %v", active, err)
	}
	files, err := filepath.Glob(filepath.Join(root, "recycle", "projects", "*.json"))
	if err != nil || len(files) != 1 {
		t.Fatalf("missing NAS project archive: %v %v", files, err)
	}
	if _, err := s.repo.ProjectForUser("admin", "story-delete"); err == nil {
		t.Fatal("deleted project still accessible")
	}
}
