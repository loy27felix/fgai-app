package app

import (
	"errors"
	"gorm.io/gorm"
	"meilin/backend/internal/model"
	"os"
	"path/filepath"
	"testing"
)

func TestFGSuperadminIsolationAndMemberManagement(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	service, db := newProjectDeleteTestService(t)
	root := t.TempDir()
	t.Setenv("CANVAS_FG_NAS_ROOT", root)
	if err := os.Mkdir(filepath.Join(root, "media"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "media", ".fg-studio-nas-ready"), []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		"CREATE TABLE fg_accounts(user_id TEXT PRIMARY KEY,platform_role TEXT)",
		"INSERT INTO fg_accounts VALUES('admin','superadmin'),('alice','superadmin'),('bob','member')",
		"CREATE TABLE fg_story_projects(native_project_id TEXT PRIMARY KEY)",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	project := model.Project{ID: "admin-managed", UserID: "alice", Name: "private", Status: model.ProjectStatusActive}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteProject("bob", project.ID); err == nil {
		t.Fatal("member deleted private project")
	}
	if _, err := service.repo.ProjectForUser("admin", project.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("admin could read private project", err)
	}
	if err := service.DeleteProject("admin", project.ID); err == nil {
		t.Fatal("admin deleted private project")
	}
	if err := db.First(&model.Project{}, "id = ?", project.ID).Error; err != nil {
		t.Fatal("private project changed", err)
	}
	if err := db.Exec("INSERT INTO fg_story_projects VALUES(?)", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.repo.ProjectForUser("admin", project.ID); err != nil {
		t.Fatal("admin cannot read shared story project", err)
	}
	if _, err := service.repo.ProjectForUser("bob", project.ID); err != nil {
		t.Fatal("member cannot read shared story project", err)
	}
	if err := service.DeleteProject("bob", project.ID); err == nil {
		t.Fatal("ordinary member deleted shared project")
	}
	if err := service.DeleteProject("admin", project.ID); err != nil {
		t.Fatal("admin cannot archive shared project", err)
	}
	var archived model.Project
	if err := db.First(&archived, "id = ?", project.ID).Error; err != nil || archived.FGDeletedAt == nil {
		t.Fatal("project aggregate not retained", err)
	}
	memberProject := model.Project{ID: "member-managed", UserID: "bob", Name: "member private", Status: model.ProjectStatusActive}
	if err := db.Create(&memberProject).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteProject("admin", memberProject.ID); err != nil {
		t.Fatal("administrator cannot delete member project", err)
	}
	// The elevated FG role never changes standalone upstream permissions.
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "false")
	project.ID = "standalone-private"
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.DeleteProject("admin", project.ID); err == nil {
		t.Fatal("FG role escaped module boundary")
	}
}
