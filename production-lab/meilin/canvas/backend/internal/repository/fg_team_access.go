package repository

import (
	"encoding/json"
	"gorm.io/gorm"
	"meilin/backend/internal/assets"
	"meilin/backend/internal/model"
	"os"
)

// This extension is enabled only in the independent FG sixth-module service.
// Stories are company-shared. Administrators can manage members' private work,
// while administrators' own work remains isolated from other administrators.
func fgTeamEnabled() bool { return os.Getenv("CANVAS_FG_TEAM_WORKSPACE") == "true" }

func fgPublicDemo(db *gorm.DB, userID string) bool {
	if !fgTeamEnabled() {
		return false
	}
	lookup := db.Session(&gorm.Session{NewDB: true})
	var count int64
	// Use the server-maintained account bridge, never a client scope flag.
	return lookup.Table("fg_accounts").Where("user_id=? AND email=?", userID, "test@beva.com").Count(&count).Error == nil && count == 1
}

func fgProjectScope(db *gorm.DB, table, userID string) *gorm.DB {
	if fgPublicDemo(db, userID) {
		return db.Where(table+".fg_deleted_at IS NULL AND "+table+".user_id = ?", userID)
	}
	if !fgTeamEnabled() {
		return db.Where(table+".user_id = ?", userID)
	}
	return db.Where(table+".fg_deleted_at IS NULL").Where("("+table+".user_id = ? OR EXISTS (SELECT 1 FROM fg_story_projects fg WHERE fg.native_project_id = "+table+".id)"+fgMemberManagementScope(db, userID, table+".user_id")+")", userID)
}
func fgCanvasScope(db *gorm.DB, userID string) *gorm.DB {
	db = db.Where("canvas_projects.deleted_at IS NULL")
	if fgPublicDemo(db, userID) {
		return db.Where("canvas_projects.user_id = ?", userID)
	}
	if !fgTeamEnabled() {
		return db.Where("canvas_projects.user_id = ?", userID)
	}
	return db.Where("(canvas_projects.user_id = ? OR EXISTS (SELECT 1 FROM fg_story_projects fg WHERE fg.native_project_id = canvas_projects.project_id)"+fgMemberManagementScope(db, userID, "canvas_projects.user_id")+")", userID)
}
func fgMediaScope(db *gorm.DB, table, grantTable, grantColumn, userID string) *gorm.DB {
	if fgPublicDemo(db, userID) {
		return db.Where(table+".user_id = ?", userID)
	}
	if !fgTeamEnabled() {
		return db.Where(table+".user_id = ?", userID)
	}
	company := ""
	if table == "resources" {
		company = " OR EXISTS (SELECT 1 FROM fg_company_assets ca WHERE ca.resource_id=resources.id)"
	}
	condition := "(" + table + ".user_id = ? OR EXISTS (SELECT 1 FROM " + grantTable + " g JOIN fg_story_projects fg ON fg.native_project_id=g.project_id WHERE g." + grantColumn + "=" + table + ".id)" + company + fgMemberManagementScope(db, userID, table+".user_id")
	args := []any{userID}
	lookup := db.Session(&gorm.Session{NewDB: true})
	// A collaborator may bind their own media inside somebody else's project.
	// The persisted project link grants its owner access, without publishing it
	// to unrelated members or making the collaborator's other media visible.
	if lookup.Migrator().HasTable(&model.ProjectAssetLink{}) {
		projects := fgProjectScope(lookup.Table("projects"), "projects", userID).Select("projects.id")
		if table == "assets" {
			condition += " OR EXISTS (SELECT 1 FROM project_asset_links pal WHERE pal.asset_id=assets.id AND pal.project_id IN (?))"
			args = append(args, projects)
		} else if table == "resources" && lookup.Migrator().HasTable(&model.AssetRepresentation{}) && lookup.Migrator().HasTable(&model.AssetVersion{}) {
			condition += " OR EXISTS (SELECT 1 FROM asset_representations ar JOIN asset_versions av ON av.id=ar.asset_version_id JOIN project_asset_links pal ON pal.asset_id=av.asset_id WHERE ar.resource_id=resources.id AND pal.project_id IN (?))"
			args = append(args, projects)
		}
	}
	if table == "resources" && lookup.Migrator().HasTable(&model.ShotArtifact{}) {
		projects := fgProjectScope(lookup.Table("projects"), "projects", userID).Select("projects.id")
		condition += " OR EXISTS (SELECT 1 FROM shot_artifacts sa WHERE sa.resource_id=resources.id AND sa.project_id IN (?))"
		args = append(args, projects)
	}
	return db.Where(condition+")", args...)
}
func (r *Repository) FGSharedProject(id string) bool {
	if !fgTeamEnabled() || id == "" {
		return false
	}
	var count int64
	return r.db.Table("fg_story_projects fg").Joins("JOIN projects p ON p.id=fg.native_project_id AND p.fg_deleted_at IS NULL").Where("fg.native_project_id = ?", id).Count(&count).Error == nil && count > 0
}

func (r *Repository) FGCanDeleteProject(actor string, project model.Project) bool {
	if r.FGSharedProject(project.ID) {
		return fgSuperadmin(r.db, actor)
	}
	return r.FGCanManageOwner(actor, project.UserID)
}
func (r *Repository) FGIsAdministrator(actor string) bool {
	return fgTeamEnabled() && fgSuperadmin(r.db, actor)
}
func fgSuperadmin(db *gorm.DB, userID string) bool {
	// A scope may receive an existing Model/Where statement. Role lookups must
	// not replace its target table or carry its predicates into the account query.
	// NewDB preserves the caller's transaction connection, with a fresh statement.
	lookup := db.Session(&gorm.Session{NewDB: true})
	if !lookup.Migrator().HasTable("fg_accounts") {
		return false
	}
	var count int64
	return lookup.Table("fg_accounts").Where("user_id=? AND platform_role='superadmin'", userID).Count(&count).Error == nil && count == 1
}

func fgMemberManagementScope(db *gorm.DB, userID, ownerColumn string) string {
	if !fgTeamEnabled() || !fgSuperadmin(db, userID) {
		return ""
	}
	// Only recognized ordinary-user roles qualify; missing accounts fail closed.
	return " OR EXISTS (SELECT 1 FROM fg_accounts managed WHERE managed.user_id=" + ownerColumn + " AND managed.platform_role IN ('user','member'))"
}

func (r *Repository) FGCanManageOwner(userID, ownerID string) bool {
	if userID == ownerID {
		return true
	}
	if !fgTeamEnabled() || !fgSuperadmin(r.db, userID) {
		return false
	}
	var count int64
	return r.db.Session(&gorm.Session{NewDB: true}).Table("fg_accounts").Where("user_id=? AND platform_role IN ('user','member')", ownerID).Count(&count).Error == nil && count == 1
}

// Called inside the existing canvas-save transaction after resource validation.
// Only actor-owned or already shared media can be published, never arbitrary
// private resource IDs supplied in a document.
func (r *Repository) fgPublishCanvasMedia(project *model.CanvasProject) error {
	if !r.FGSharedProject(project.ProjectID) {
		return nil
	}
	refs := map[string]struct{}{}
	if err := assets.CollectOwnedDocumentReferences(project.PayloadJSON, refs); err != nil {
		return err
	}
	if len(refs) > 0 {
		var resources []model.Resource
		if err := fgMediaScope(r.db, "resources", "fg_resource_grants", "resource_id", project.UserID).Where("resources.id IN ?", assets.SortedIDs(refs)).Find(&resources).Error; err != nil {
			return err
		}
		if len(resources) != len(refs) {
			return ErrCanvasHistoryResourceMissing
		}
		for _, res := range resources {
			if err := r.db.Exec("INSERT INTO fg_resource_grants(project_id,resource_id) VALUES(?,?) ON CONFLICT DO NOTHING", project.ProjectID, res.ID).Error; err != nil {
				return err
			}
		}
	}
	var doc any
	if err := json.Unmarshal([]byte(project.PayloadJSON), &doc); err != nil {
		return err
	}
	ids := map[string]struct{}{}
	var visit func(any)
	visit = func(value any) {
		switch v := value.(type) {
		case map[string]any:
			for key, child := range v {
				if key == "assetId" {
					if id, ok := child.(string); ok && id != "" {
						ids[id] = struct{}{}
					}
				}
				visit(child)
			}
		case []any:
			for _, child := range v {
				visit(child)
			}
		}
	}
	visit(doc)
	for id := range ids {
		var asset model.Asset
		if err := fgMediaScope(r.db, "assets", "fg_asset_grants", "asset_id", project.UserID).Where("assets.id = ?", id).First(&asset).Error; err != nil {
			return err
		}
		if err := r.db.Exec("INSERT INTO fg_asset_grants(project_id,asset_id) VALUES(?,?) ON CONFLICT DO NOTHING", project.ProjectID, asset.ID).Error; err != nil {
			return err
		}
	}
	return nil
}

func (r *Repository) FGValidateProjectAccess(userID, projectID string) error {
	if !fgTeamEnabled() || projectID == "" {
		return nil
	}
	_, err := r.ProjectForUser(userID, projectID)
	return err
}
