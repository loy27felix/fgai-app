package repository

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
)

func TestFGPublicDemoCannotInheritCompanyOrSharedMedia(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	for _, q := range []string{
		"CREATE TABLE fg_accounts(user_id TEXT,email TEXT,platform_role TEXT)",
		"INSERT INTO fg_accounts VALUES('demo','test@beva.com','user'),('member','member@beva.com','user')",
		"CREATE TABLE projects(id TEXT,user_id TEXT,fg_deleted_at TEXT)",
		"INSERT INTO projects VALUES('mine','demo',NULL),('company','member',NULL)",
		"CREATE TABLE canvas_projects(id TEXT,user_id TEXT,project_id TEXT,deleted_at TEXT)",
		"INSERT INTO canvas_projects VALUES('mine','demo','mine',NULL),('company','member','company',NULL)",
		"CREATE TABLE resources(id TEXT,user_id TEXT)",
		"INSERT INTO resources VALUES('mine','demo'),('company','member')",
		"CREATE TABLE fg_story_projects(native_project_id TEXT)",
		"INSERT INTO fg_story_projects VALUES('company')",
		"CREATE TABLE fg_company_assets(resource_id TEXT)",
		"INSERT INTO fg_company_assets VALUES('company')",
		"CREATE TABLE fg_resource_grants(project_id TEXT,resource_id TEXT)",
	} {
		if err = db.Exec(q).Error; err != nil {
			t.Fatal(err)
		}
	}
	for table, scope := range map[string]*gorm.DB{
		"projects":        fgProjectScope(db.Table("projects"), "projects", "demo"),
		"canvas_projects": fgCanvasScope(db.Table("canvas_projects"), "demo"),
		"resources":       fgMediaScope(db.Table("resources"), "resources", "fg_resource_grants", "resource_id", "demo"),
	} {
		var ids []string
		if err = scope.Pluck("id", &ids).Error; err != nil || len(ids) != 1 || ids[0] != "mine" {
			t.Fatalf("%s leaked: %v %v", table, ids, err)
		}
	}
	var ids []string
	if err = fgProjectScope(db.Table("projects"), "projects", "member").Pluck("id", &ids).Error; err != nil || len(ids) != 1 || ids[0] != "company" {
		t.Fatalf("normal member scope changed: %v %v", ids, err)
	}
}
