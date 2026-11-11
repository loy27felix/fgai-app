package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"meilin/backend/internal/model"
	"time"
)

// Recycle listing does not inherit story visibility: only the owner and an
// administrator managing an ordinary user can recover a deleted document.
func (r *Repository) FGRecycledCanvases(userID string) ([]model.CanvasProject, error) {
	if !fgTeamEnabled() {
		return nil, gorm.ErrRecordNotFound
	}
	var rows []model.CanvasProject
	err := r.db.Model(&model.CanvasProject{}).Where("deleted_at IS NOT NULL AND purged_at IS NULL").Where("(user_id=?"+fgMemberManagementScope(r.db, userID, "canvas_projects.user_id")+")", userID).
		Select("id", "user_id", "project_id", "title", "revision", "deleted_at", "deleted_by", "updated_at").Order("deleted_at DESC, id ASC").Find(&rows).Error
	return rows, err
}

func (r *Repository) FGRestoreCanvas(userID, id string) error {
	if !fgTeamEnabled() {
		return gorm.ErrRecordNotFound
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var canvas model.CanvasProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id=? AND deleted_at IS NOT NULL AND purged_at IS NULL", id).First(&canvas).Error; err != nil {
			return err
		}
		if !New(tx).FGCanManageOwner(userID, canvas.UserID) {
			return gorm.ErrRecordNotFound
		}
		result := tx.Model(&model.CanvasProject{}).Where("id=? AND deleted_at IS NOT NULL", id).Updates(map[string]any{"deleted_at": nil, "deleted_by": "", "revision": gorm.Expr("revision+1"), "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}
