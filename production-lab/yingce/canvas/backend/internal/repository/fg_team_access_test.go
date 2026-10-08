package repository

import (
 "errors"
 "path/filepath"
 "testing"
 "time"
 "infinite-canvas/backend/internal/model"
 "gorm.io/driver/sqlite"
 "gorm.io/gorm"
)

func TestFGAdvertisingMembershipRevokesProjectAccess(t *testing.T) {
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE","true")
 db,err:=gorm.Open(sqlite.Open(filepath.Join(t.TempDir(),"ads.db")),&gorm.Config{})
 if err!=nil{t.Fatal(err)}
 sqlDB,_:=db.DB();defer sqlDB.Close();sqlDB.SetMaxOpenConns(1)
 if err=db.AutoMigrate(&model.Project{});err!=nil{t.Fatal(err)}
 for _,sql:=range []string{
  "CREATE TABLE fg_story_projects(native_project_id TEXT)",
  "CREATE TABLE fg_adcraft_workspaces(id TEXT,native_project_id TEXT,owner_id TEXT,group_id TEXT,archived_at TEXT)",
  "CREATE TABLE fg_adcraft_members(workspace_id TEXT,user_id TEXT)",
  "CREATE TABLE fg_groups(id TEXT,archived_at TEXT)",
  "CREATE TABLE fg_memberships(group_id TEXT,user_id TEXT,unassigned_at TEXT)",
  "INSERT INTO fg_groups VALUES('team',NULL)",
  "INSERT INTO fg_memberships VALUES('team','bob',NULL)",
  "INSERT INTO fg_adcraft_workspaces VALUES('ad','advert','alice','team',NULL)",
 }{if err=db.Exec(sql).Error;err!=nil{t.Fatal(err)}}
 if err=db.Create(&model.Project{ID:"advert",UserID:"alice",Name:"ad"}).Error;err!=nil{t.Fatal(err)}
 repo:=New(db)
 if _,err=repo.ProjectForUser("bob","advert");!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("mythology group leaked into advertising access")}
 if err=db.Exec("INSERT INTO fg_adcraft_members VALUES('ad','bob')").Error;err!=nil{t.Fatal(err)}
 if _,err=repo.ProjectForUser("bob","advert");err!=nil{t.Fatal(err)}
 if _,err=repo.ProjectForUser("unrelated","advert");!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("advertising project leaked")}
 if err=db.Exec("DELETE FROM fg_adcraft_members WHERE user_id='bob'").Error;err!=nil{t.Fatal(err)}
 if _,err=repo.ProjectForUser("bob","advert");!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("removed teammate retained access")}
 if _,err=repo.ProjectForUser("alice","advert");err!=nil{t.Fatal(err)}
}

func TestFGAdvertisingDeletionArchivesWithoutBreakingForeignKeys(t *testing.T) {
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE","true")
 db,err:=gorm.Open(sqlite.Open(filepath.Join(t.TempDir(),"ad-delete.db")),&gorm.Config{})
 if err!=nil{t.Fatal(err)}
 sqlDB,_:=db.DB();defer sqlDB.Close();sqlDB.SetMaxOpenConns(1)
 if err=db.AutoMigrate(&model.Project{},&model.Task{});err!=nil{t.Fatal(err)}
 for _,sql:=range []string{
  "PRAGMA foreign_keys=ON",
  "CREATE TABLE fg_story_projects(native_project_id TEXT)",
  "CREATE TABLE fg_adcraft_workspaces(id TEXT,native_project_id TEXT REFERENCES projects(id),owner_id TEXT,archived_at TEXT)",
  "CREATE TABLE fg_adcraft_members(workspace_id TEXT,user_id TEXT)",
 }{if err=db.Exec(sql).Error;err!=nil{t.Fatal(err)}}
 if err=db.Create(&model.Project{ID:"advert",UserID:"alice",Name:"ad",Type:"advertising",Status:model.ProjectStatusActive}).Error;err!=nil{t.Fatal(err)}
 if err=db.Create(&model.Project{ID:"drama",UserID:"alice",Name:"drama",Type:"drama",Status:model.ProjectStatusActive}).Error;err!=nil{t.Fatal(err)}
 if err=db.Exec("INSERT INTO fg_adcraft_workspaces VALUES('ad','advert','alice',NULL)").Error;err!=nil{t.Fatal(err)}
 repo:=New(db)
 listed,err:=repo.Projects("alice");if err!=nil||len(listed)!=1||listed[0].ID!="drama"{t.Fatalf("mixed project list: %+v %v",listed,err)}
 if err=repo.DeleteProject("alice","advert",nil);err!=nil{t.Fatal("archive must retain FK",err)}
 var project model.Project
 if err=db.First(&project,"id = ?","advert").Error;err!=nil||project.Status!=model.ProjectStatusArchived{t.Fatalf("project retained: %+v %v",project,err)}
 var active int64
 if err=db.Table("fg_adcraft_workspaces").Where("archived_at IS NULL").Count(&active).Error;err!=nil||active!=0{t.Fatal("workspace still active",err)}
}

func TestFGSuperadminScopePreservesCanvasSaveStatement(t *testing.T) {
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE","true")
 db,err:=gorm.Open(sqlite.Open(filepath.Join(t.TempDir(),"admin.db")),&gorm.Config{})
 if err!=nil{t.Fatal(err)}
 sqlDB,_:=db.DB();defer sqlDB.Close();sqlDB.SetMaxOpenConns(1)
 if err=db.AutoMigrate(&model.Project{},&model.CanvasProject{},&model.Resource{},&model.CanvasSnapshot{},&model.CanvasSnapshotResource{},&model.CanvasShare{},&model.CanvasUnitLink{},&model.Task{});err!=nil{t.Fatal(err)}
 for _,sql:=range []string{
  "CREATE TABLE fg_accounts(user_id TEXT PRIMARY KEY,platform_role TEXT)",
  "INSERT INTO fg_accounts VALUES('admin','superadmin'),('alice','member'),('bob','member')",
  "CREATE TABLE fg_story_projects(native_project_id TEXT PRIMARY KEY)",
  "CREATE TABLE fg_resource_grants(project_id TEXT,resource_id TEXT)",
  "CREATE TABLE fg_company_assets(resource_id TEXT)",
 }{if err=db.Exec(sql).Error;err!=nil{t.Fatal(err)}}
 repo:=New(db)
 if err=db.Create(&model.Project{ID:"private",UserID:"alice",Name:"private"}).Error;err!=nil{t.Fatal(err)}
 if _,err=repo.ProjectForUser("admin","private");err!=nil{t.Fatal(err)}
 if _,err=repo.ProjectForUser("bob","private");!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("private project leaked",err)}
 canvas:=model.CanvasProject{ID:"admin-canvas",UserID:"admin",PayloadJSON:`{"nodes":[]}`}
 if err=repo.UpsertCanvasProject(&canvas);err!=nil{t.Fatal(err)}
 canvas.Title="saved by admin"
 if err=repo.UpsertCanvasProject(&canvas);err!=nil{t.Fatal("model-scoped admin save failed",err)}
 if canvas.Revision!=2{t.Fatal("revision did not increment")}
 canvas.Title="transactional save"
 if err=repo.SaveCanvasWithSnapshot(&canvas,nil,nil,nil,time.Now(),20,false);err!=nil{t.Fatal("transaction-scoped save failed",err)}
 stored,err:=repo.CanvasProjectForUser("admin",canvas.ID)
 if err!=nil||stored.Title!=canvas.Title||stored.Revision!=3{t.Fatalf("stored canvas: %+v, %v",stored,err)}
 if _,err=repo.CanvasProjectForUser("bob",canvas.ID);!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("admin canvas leaked",err)}
 // A caller's existing predicates must not restrict the separate role lookup.
 scoped:=db.Model(&model.CanvasProject{}).Where("canvas_projects.id = ?",canvas.ID)
 if !fgSuperadmin(scoped,"admin"){t.Fatal("role lookup inherited canvas predicates")}
 if err=scoped.Update("title","scope preserved").Error;err!=nil{t.Fatal("role lookup mutated caller",err)}
 resource:=model.Resource{ID:"private-resource",UserID:"alice",Status:model.ResourceStatusReady}
 if err=db.Create(&resource).Error;err!=nil{t.Fatal(err)}
 if _,err=repo.ResourceForUser("admin",resource.ID);err!=nil{t.Fatal("admin media scope failed",err)}
 if _,err=repo.ResourceForUser("bob",resource.ID);!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("private media leaked",err)}
 if !repo.FGCanManageOwner("admin","alice")||repo.FGCanManageOwner("bob","alice"){t.Fatal("owner management permissions incorrect")}
 foreign:=model.CanvasProject{ID:"foreign-canvas",UserID:"alice",PayloadJSON:`{"nodes":[]}`}
 if err=repo.UpsertCanvasProject(&foreign);err!=nil{t.Fatal(err)}
 if err=repo.DeleteCanvasProject("bob",foreign.ID);!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("member deleted another owner's canvas",err)}
 if err=repo.DeleteCanvasProject("admin",foreign.ID);err!=nil{t.Fatal("admin delete failed",err)}
 if _,err=repo.CanvasProjectForUser("alice",foreign.ID);!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("admin delete did not remove canvas",err)}
}

func TestFGTeamCanvasIsolationAndAtomicMedia(t *testing.T) {
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE","true")
 db,err:=gorm.Open(sqlite.Open(filepath.Join(t.TempDir(),"fg.db")),&gorm.Config{})
 if err!=nil{t.Fatal(err)}
 sqlDB,_:=db.DB();defer sqlDB.Close();sqlDB.SetMaxOpenConns(1)
 if err=db.AutoMigrate(&model.FGCompanyAsset{},&model.Project{},&model.CanvasProject{},&model.Asset{},&model.Resource{},&model.CanvasSnapshot{},&model.CanvasSnapshotResource{});err!=nil{t.Fatal(err)}
 for _,sql:=range []string{"CREATE TABLE fg_story_projects(native_project_id TEXT PRIMARY KEY)","CREATE TABLE fg_resource_grants(project_id TEXT,resource_id TEXT,PRIMARY KEY(project_id,resource_id))","CREATE TABLE fg_asset_grants(project_id TEXT,asset_id TEXT,PRIMARY KEY(project_id,asset_id))"}{if err=db.Exec(sql).Error;err!=nil{t.Fatal(err)}}
 repo:=New(db)
 for _,p:=range []model.Project{{ID:"shared",UserID:"alice",Name:"story"},{ID:"private",UserID:"alice",Name:"private"}}{if err=db.Create(&p).Error;err!=nil{t.Fatal(err)}}
 if err=db.Exec("INSERT INTO fg_story_projects VALUES('shared')").Error;err!=nil{t.Fatal(err)}
 if _,err=repo.ProjectForUser("bob","shared");err!=nil{t.Fatal(err)}
 if _,err=repo.ProjectForUser("bob","private");!errors.Is(err,gorm.ErrRecordNotFound){t.Fatalf("private project leaked: %v",err)}
 for _,p:=range []model.CanvasProject{{ID:"ep1",UserID:"alice",ProjectID:"shared",PayloadJSON:`{"nodes":[]}`},{ID:"ep2",UserID:"bob",ProjectID:"shared",PayloadJSON:`{"nodes":[]}`},{ID:"personal",UserID:"alice",PayloadJSON:`{"nodes":[]}`}}{if err=repo.UpsertCanvasProject(&p);err!=nil{t.Fatal(err)}}
 if _,err=repo.CanvasProjectForUser("bob","personal");!errors.Is(err,gorm.ErrRecordNotFound){t.Fatalf("personal canvas leaked: %v",err)}
 shared,err:=repo.CanvasProjectForUser("bob","ep1");if err!=nil{t.Fatal(err)}
 shared.UserID="bob";shared.Title="bob edit"
 if err=repo.SaveCanvasWithSnapshot(shared,nil,nil,nil,time.Now(),20,false);err!=nil{t.Fatal(err)}
 stored,_:=repo.CanvasProjectForUser("alice","ep1");if stored.UserID!="alice"||stored.Revision!=2||stored.Title!="bob edit"{t.Fatalf("owner/revision: %+v",stored)}
 res:=model.Resource{ID:"bob-resource",UserID:"bob",Status:model.ResourceStatusReady};if err=db.Create(&res).Error;err!=nil{t.Fatal(err)}
 asset:=model.Asset{ID:"bob-asset",UserID:"bob",PayloadJSON:`{"storageKey":"resource:bob-resource"}`};if err=db.Create(&asset).Error;err!=nil{t.Fatal(err)}
 stale:=*shared;stale.UserID="bob";stale.Revision=1;stale.PayloadJSON=`{"nodes":[{"type":"image","metadata":{"assetId":"bob-asset","storageKey":"resource:bob-resource"}}]}`
 if err=repo.SaveCanvasWithSnapshot(&stale,nil,nil,[]string{res.ID},time.Now(),20,false);!errors.Is(err,ErrCanvasRevisionConflict){t.Fatalf("stale save: %v",err)}
 var count int64;db.Table("fg_resource_grants").Count(&count);if count!=0{t.Fatal("failed save published media")}
 stale.Revision=2
 if err=repo.SaveCanvasWithSnapshot(&stale,nil,nil,[]string{res.ID},time.Now(),20,false);err!=nil{t.Fatal(err)}
 if _,err=repo.ResourceForUser("alice",res.ID);err!=nil{t.Fatal("shared resource unavailable",err)}
 if _,err=repo.AssetForUser("alice",asset.ID);err!=nil{t.Fatal("shared asset unavailable",err)}
 foreign:=model.Resource{ID:"private-foreign",UserID:"charlie",Status:model.ResourceStatusReady};if err=db.Create(&foreign).Error;err!=nil{t.Fatal(err)}
 forged:=stale;forged.UserID="bob";forged.PayloadJSON=`{"nodes":[{"type":"image","metadata":{"storageKey":"resource:private-foreign"}}]}`
 if err=repo.SaveCanvasWithSnapshot(&forged,nil,nil,[]string{foreign.ID},time.Now(),20,false);err==nil{t.Fatal("forged document published foreign private media")}
 if _,err=repo.ResourceForUser("alice",foreign.ID);!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("foreign private resource leaked")}
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE","false")
 if _,err=repo.CanvasProjectForUser("bob","ep1");!errors.Is(err,gorm.ErrRecordNotFound){t.Fatal("sharing escaped FG flag")}
}
