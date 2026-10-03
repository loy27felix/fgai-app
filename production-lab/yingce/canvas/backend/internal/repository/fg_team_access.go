package repository

import (
 "encoding/json"
 "os"
 "infinite-canvas/backend/internal/assets"
 "infinite-canvas/backend/internal/model"
 "gorm.io/gorm"
)

// This extension is enabled only in the independent FG sixth-module service.
// Story-linked workspaces are company-shared; all other objects stay private.
func fgTeamEnabled() bool { return os.Getenv("CANVAS_FG_TEAM_WORKSPACE") == "true" }

func fgProjectScope(db *gorm.DB, table, userID string) *gorm.DB {
 if !fgTeamEnabled(){ return db.Where(table+".user_id = ?",userID) }
 if fgSuperadmin(db,userID){return db}
 if db.Migrator().HasTable("fg_adcraft_workspaces") {
  return db.Where("("+table+".user_id = ? OR EXISTS (SELECT 1 FROM fg_story_projects fg WHERE fg.native_project_id = "+table+".id) OR EXISTS (SELECT 1 FROM fg_adcraft_workspaces w WHERE w.native_project_id="+table+".id AND w.archived_at IS NULL AND (w.owner_id=? OR EXISTS(SELECT 1 FROM fg_adcraft_members a WHERE a.workspace_id=w.id AND a.user_id=?))))",userID,userID,userID)
 }
 return db.Where("("+table+".user_id = ? OR EXISTS (SELECT 1 FROM fg_story_projects fg WHERE fg.native_project_id = "+table+".id))",userID)
}
func fgCanvasScope(db *gorm.DB,userID string) *gorm.DB {
 if !fgTeamEnabled(){return db.Where("canvas_projects.user_id = ?",userID)}
 if fgSuperadmin(db,userID){return db}
 return db.Where("(canvas_projects.user_id = ? OR EXISTS (SELECT 1 FROM fg_story_projects fg WHERE fg.native_project_id = canvas_projects.project_id))",userID)
}
func fgMediaScope(db *gorm.DB,table,grantTable,grantColumn,userID string) *gorm.DB {
 if !fgTeamEnabled(){return db.Where(table+".user_id = ?",userID)}
 if fgSuperadmin(db,userID){return db}
 company:="";if table=="resources"{company=" OR EXISTS (SELECT 1 FROM fg_company_assets ca WHERE ca.resource_id=resources.id)"}
 return db.Where("("+table+".user_id = ? OR EXISTS (SELECT 1 FROM "+grantTable+" g JOIN fg_story_projects fg ON fg.native_project_id=g.project_id WHERE g."+grantColumn+"="+table+".id)"+company+")",userID)
}
func (r *Repository) FGSharedProject(id string) bool {
 if !fgTeamEnabled() || id=="" {return false}
 var count int64
 return r.db.Table("fg_story_projects").Where("native_project_id = ?",id).Count(&count).Error==nil && count>0
}
func fgSuperadmin(db *gorm.DB,userID string) bool {
 // A scope may receive an existing Model/Where statement. Role lookups must
 // not replace its target table or carry its predicates into the account query.
 // NewDB preserves the caller's transaction connection, with a fresh statement.
 lookup:=db.Session(&gorm.Session{NewDB:true})
 if !lookup.Migrator().HasTable("fg_accounts"){return false}
 var count int64
 return lookup.Table("fg_accounts").Where("user_id=? AND platform_role='superadmin'",userID).Count(&count).Error==nil&&count==1
}

// Called inside the existing canvas-save transaction after resource validation.
// Only actor-owned or already shared media can be published, never arbitrary
// private resource IDs supplied in a document.
func (r *Repository) fgPublishCanvasMedia(project *model.CanvasProject) error {
 if !r.FGSharedProject(project.ProjectID){return nil}
 refs:=map[string]struct{}{}
 if err:=assets.CollectOwnedDocumentReferences(project.PayloadJSON,refs);err!=nil{return err}
 if len(refs)>0 {
  var resources []model.Resource
  if err:=fgMediaScope(r.db,"resources","fg_resource_grants","resource_id",project.UserID).Where("resources.id IN ?",assets.SortedIDs(refs)).Find(&resources).Error;err!=nil{return err}
  if len(resources)!=len(refs){return ErrCanvasHistoryResourceMissing}
  for _,res:=range resources {if err:=r.db.Exec("INSERT INTO fg_resource_grants(project_id,resource_id) VALUES(?,?) ON CONFLICT DO NOTHING",project.ProjectID,res.ID).Error;err!=nil{return err}}
 }
 var doc any
 if err:=json.Unmarshal([]byte(project.PayloadJSON),&doc);err!=nil{return err}
 ids:=map[string]struct{}{}
 var visit func(any)
 visit=func(value any){switch v:=value.(type){case map[string]any:for key,child:=range v{if key=="assetId"{if id,ok:=child.(string);ok&&id!=""{ids[id]=struct{}{}}};visit(child)};case []any:for _,child:=range v{visit(child)}}}
 visit(doc)
 for id:=range ids {
  var asset model.Asset
  if err:=fgMediaScope(r.db,"assets","fg_asset_grants","asset_id",project.UserID).Where("assets.id = ?",id).First(&asset).Error;err!=nil{return err}
  if err:=r.db.Exec("INSERT INTO fg_asset_grants(project_id,asset_id) VALUES(?,?) ON CONFLICT DO NOTHING",project.ProjectID,asset.ID).Error;err!=nil{return err}
 }
 return nil
}

func (r *Repository) FGValidateProjectAccess(userID,projectID string) error {
 if !fgTeamEnabled()||projectID=="" {return nil}
 _,err:=r.ProjectForUser(userID,projectID)
 return err
}
