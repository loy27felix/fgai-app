package repository

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

// Share validity, owned assets and the new canvas commit together. A revoked or
// rotated token cannot publish a copy after a slow media transfer completes.
func (r *Repository) CreateCanvasCopy(shareID, tokenHash string, project *model.CanvasProject, library []model.Asset) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var share model.CanvasShare
		query := tx.Where("id = ? AND token_hash = ? AND enabled = ? AND (expires_at IS NULL OR expires_at > ?)", shareID, tokenHash, true, time.Now())
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&share).Error; err != nil {
			return err
		}
		var original model.CanvasProject
		if err := tx.Select("id").Where("id = ? AND user_id = ?", share.ProjectID, share.UserID).First(&original).Error; err != nil {
			return err
		}
		resourceIDs := map[string]struct{}{}
		for _, asset := range library {
			if asset.UserID != project.UserID {
				return gorm.ErrRecordNotFound
			}
			if err := assets.CollectOwnedDocumentReferences(asset.PayloadJSON, resourceIDs); err != nil {
				return err
			}
		}
		if len(resourceIDs) > 0 {
			var resources []model.Resource
			query := tx.Select("id").Where("id IN ? AND user_id = ? AND status = ?", assets.SortedIDs(resourceIDs), project.UserID, model.ResourceStatusReady).Order("id")
			if r.Dialect() == "postgres" {
				query = query.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := query.Find(&resources).Error; err != nil {
				return err
			}
			if len(resources) != len(resourceIDs) {
				return gorm.ErrRecordNotFound
			}
		}
		if len(library) > 0 {
			if err := tx.Create(&library).Error; err != nil {
				return err
			}
		}
		return New(tx).UpsertCanvasProject(project)
	})
}
