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
