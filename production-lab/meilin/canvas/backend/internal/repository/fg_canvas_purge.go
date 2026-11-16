package repository

import (
	"encoding/json"
	"errors"
	"meilin/backend/internal/assets"
	"meilin/backend/internal/model"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Document data lives in PostgreSQL, not in a per-canvas NAS directory.
// Export the full document/history before removing it from the application.
type FGCanvasRecycleArchive struct {
	Format      string                   `json:"format"`
	Canvas      model.CanvasProject      `json:"canvas"`
	History     []FGCanvasRecycleHistory `json:"history"`
	ResourceIDs []string                 `json:"resourceIds"`
}
type FGCanvasRecycleHistory struct {
	Snapshot    model.CanvasSnapshot `json:"snapshot"`
	PayloadJSON string               `json:"payloadJson"`
}

func (r *Repository) FGExpiredRecycledCanvases(cutoff time.Time, limit int) ([]model.CanvasProject, error) {
	if !fgTeamEnabled() {
		return nil, nil
	}
	var rows []model.CanvasProject
	err := r.db.Select("id", "user_id").Where("deleted_at <= ? AND purged_at IS NULL", cutoff).Order("deleted_at,id").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) FGPurgeCanvas(actorID, id string, cutoff *time.Time, archive func(FGCanvasRecycleArchive) error) error {
	if !fgTeamEnabled() {
		return gorm.ErrRecordNotFound
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var canvas model.CanvasProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND deleted_at IS NOT NULL", id).First(&canvas).Error; err != nil {
			return err
		}
		if cutoff == nil {
			if !New(tx).FGCanManageOwner(actorID, canvas.UserID) {
				return gorm.ErrRecordNotFound
			}
		} else if canvas.DeletedAt.After(*cutoff) {
			return gorm.ErrRecordNotFound
		}
		if canvas.PurgedAt != nil {
			return nil
		}
		var active int64
		if err := tx.Model(&model.Task{}).Where("project_id=? AND status NOT IN ?", id, []string{"succeeded", "failed", "cancelled"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return errors.New("画布仍有生成任务，请结束任务后再彻底删除")
		}
		if err := tx.Model(&model.CloudAgentExecution{}).Where("canvas_id=? AND status NOT IN ?", id, []string{"completed", "failed", "cancelled"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return errors.New("画布 Agent 仍在运行，请结束后再彻底删除")
		}
		var history []model.CanvasSnapshot
		if err := tx.Where("canvas_id=?", id).Order("revision,id").Find(&history).Error; err != nil {
			return err
		}
		bundle := FGCanvasRecycleArchive{Format: "fg-canvas-recycle-v1", Canvas: canvas, History: []FGCanvasRecycleHistory{}}
		refs := map[string]struct{}{}
		if err := assets.CollectOwnedDocumentReferences(canvas.PayloadJSON, refs); err != nil {
			return err
		}
		for _, entry := range history {
			bundle.History = append(bundle.History, FGCanvasRecycleHistory{Snapshot: entry, PayloadJSON: entry.PayloadJSON})
			if err := assets.CollectOwnedDocumentReferences(entry.PayloadJSON, refs); err != nil {
				return err
			}
		}
		var historyResourceIDs []string
		if err := tx.Table("canvas_snapshot_resources").Joins("JOIN canvas_snapshots ON canvas_snapshots.id=canvas_snapshot_resources.snapshot_id").Where("canvas_snapshots.canvas_id=?", id).Pluck("canvas_snapshot_resources.resource_id", &historyResourceIDs).Error; err != nil {
			return err
		}
		for _, resourceID := range historyResourceIDs {
			refs[resourceID] = struct{}{}
		}
		bundle.ResourceIDs = assets.SortedIDs(refs)
		if err := archive(bundle); err != nil {
			return err
		}
		// Keep only media pins in the tombstone. Recycled NAS documents must not
		// lose their files to detached-resource cleanup or break shared copies.
		pins, err := json.Marshal(map[string]any{"resourceIds": bundle.ResourceIDs})
		if err != nil {
			return err
		}
		if err := tx.Model(&model.CanvasSnapshot{}).Where("canvas_id=?", id).Update("payload_json", "{}").Error; err != nil {
			return err
		}
		return tx.Model(&model.CanvasProject{}).Where("id=? AND purged_at IS NULL", id).Updates(map[string]any{"purged_at": time.Now(), "payload_json": string(pins), "revision": gorm.Expr("revision+1"), "updated_at": time.Now()}).Error
	})
}
