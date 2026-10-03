package app

import (
 "errors"
 "testing"
 "infinite-canvas/backend/internal/model"
 "gorm.io/gorm"
)

func TestFGSuperadminCanManageOtherOwnersProject(t *testing.T) {
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE","true")
 service,db:=newProjectDeleteTestService(t)
 for _,sql:=range []string{
  "CREATE TABLE fg_accounts(user_id TEXT PRIMARY KEY,platform_role TEXT)",
  "INSERT INTO fg_accounts VALUES('admin','superadmin'),('alice','member'),('bob','member')",
  "CREATE TABLE fg_story_projects(native_project_id TEXT PRIMARY KEY)",
 }{if err:=db.Exec(sql).Error;err!=nil{t.Fatal(err)}}
 project:=model.Project{ID:"admin-managed",UserID:"alice",Name:"private",Status:model.ProjectStatusActive}
 if err:=db.Create(&project).Error;err!=nil{t.Fatal(err)}
 if err:=service.DeleteProject("bob",project.ID);err==nil{t.Fatal("member deleted private project")}
 if err:=service.DeleteProject("admin",project.ID);err!=nil{t.Fatal("admin delete failed",err)}
 if err:=db.First(&model.Project{},"id = ?",project.ID).Error;!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("project was not removed",err)}
 // The elevated FG role never changes standalone upstream permissions.
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE","false")
 project.ID="standalone-private"
 if err:=db.Create(&project).Error;err!=nil{t.Fatal(err)}
 if err:=service.DeleteProject("admin",project.ID);err==nil{t.Fatal("FG role escaped module boundary")}
}
