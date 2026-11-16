package repository

import (
	"encoding/json"
	"fmt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"meilin/backend/internal/model"
	"sort"
	"time"
)

// Keep the native aggregate and cost attribution immutable. A verified NAS
// snapshot is required before hiding the project and releasing its story claim.
func (r *Repository) FGArchiveProject(actor, id string, archive func(string, int64, []byte) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var project model.Project
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND fg_deleted_at IS NULL", id).First(&project).Error; err != nil {
			return err
		}
		repo := New(tx)
		if !repo.FGCanDeleteProject(actor, project) {
			return gorm.ErrRecordNotFound
		}
		var canvasIDs []string
		if err := tx.Model(&model.CanvasProject{}).Where("project_id=?", id).Pluck("id", &canvasIDs).Error; err != nil {
			return err
		}
		scopes := append([]string{id}, canvasIDs...)
		var active int64
		if err := tx.Model(&model.Task{}).Where("project_id IN ? AND status IN ?", scopes, []string{"queued", "running"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return ErrProjectHasActiveTasks
		}
		if tx.Migrator().HasTable("cloud_agent_executions") {
			if err := tx.Table("cloud_agent_executions").Where("canvas_id IN ? AND status NOT IN ?", canvasIDs, []string{"completed", "failed", "cancelled"}).Count(&active).Error; err != nil {
				return err
			}
			if active > 0 {
				return ErrProjectHasActiveTasks
			}
		}
		bundle := map[string]any{"schemaVersion": 1, "project": project, "deletedBy": actor}
		// Preserve relational rows, canvas payloads and history. Media references stay
		// pinned in the retained rows; shared or independently used media is not moved.
		for _, entry := range []struct {
			table, where string
			arg          any
		}{
			{"fg_story_projects", "native_project_id=?", id},
			{"project_units", "project_id=?", id}, {"canvas_projects", "project_id=?", id},
			{"canvas_snapshots", "canvas_id IN ?", canvasIDs}, {"canvas_snapshot_resources", "snapshot_id IN (SELECT id FROM canvas_snapshots WHERE canvas_id IN ?)", canvasIDs},
			{"canvas_unit_links", "project_id=?", id}, {"canvas_shares", "project_id IN ?", scopes},
			{"project_asset_links", "project_id=?", id}, {"project_asset_folders", "project_id=?", id}, {"project_asset_candidates", "project_id=?", id},
			{"shots", "project_id=?", id}, {"shot_artifacts", "project_id=?", id}, {"workflow_instances", "project_id=?", id},
			{"shot_revisions", "shot_id IN (SELECT id FROM shots WHERE project_id=?)", id},
			{"shot_asset_references", "shot_id IN (SELECT id FROM shots WHERE project_id=?)", id},
			{"workflow_step_instances", "workflow_instance_id IN (SELECT id FROM workflow_instances WHERE project_id=?)", id},
			{"workflow_step_tasks", "workflow_step_id IN (SELECT id FROM workflow_step_instances WHERE workflow_instance_id IN (SELECT id FROM workflow_instances WHERE project_id=?))", id},
			{"production_task_links", "project_id=?", id}, {"tasks", "project_id IN ?", scopes},
			{"fg_resource_grants", "project_id=?", id}, {"fg_asset_grants", "project_id=?", id},
		} {
			if !tx.Migrator().HasTable(entry.table) {
				continue
			}
			var rows []map[string]any
			if err := tx.Table(entry.table).Where(entry.where, entry.arg).Find(&rows).Error; err != nil {
				return err
			}
			sort.Slice(rows, func(i, j int) bool {
				a, _ := json.Marshal(rows[i])
				b, _ := json.Marshal(rows[j])
				return string(a) < string(b)
			})
			bundle[entry.table] = rows
		}
		data, err := json.Marshal(bundle)
		if err != nil {
			return err
		}
		if err = archive(project.UserID, project.Revision, data); err != nil {
			return fmt.Errorf("NAS 项目回收归档未完成，原项目仍保留: %w", err)
		}
		now := time.Now()
		if tx.Migrator().HasColumn("fg_story_projects", "archived_at") {
			if err = tx.Table("fg_story_projects").Where("native_project_id=?", id).Update("archived_at", now).Error; err != nil {
				return err
			}
		}
		// Revoke links and keep deleted story canvases out of the independent trash;
		// restoring a single document must not resurrect a retired shared aggregate.
		if err = tx.Where("project_id IN ?", scopes).Delete(&model.CanvasShare{}).Error; err != nil {
			return err
		}
		if err = tx.Model(&model.CanvasProject{}).Where("project_id=?", id).Updates(map[string]any{"deleted_at": now, "deleted_by": actor, "purged_at": now}).Error; err != nil {
			return err
		}
		name := []rune("[recycle " + id + "] " + project.Name)
		if len(name) > 240 {
			name = name[:240]
		}
		return tx.Model(&model.Project{}).Where("id=?", id).Updates(map[string]any{"fg_deleted_at": now, "status": model.ProjectStatusArchived, "name": string(name), "revision": gorm.Expr("revision+1"), "updated_at": now}).Error
	})
}
