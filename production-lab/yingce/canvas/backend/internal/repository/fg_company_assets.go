package repository

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
	"strings"
)

var ErrFGCompanyAssetConflict = errors.New("company asset revision conflict")

type FGCompanyAssetFilter struct {
	Query, Kind, Category, Brand, Character, Style, Status string
	Page, PageSize                                         int
}

func (r *Repository) FGCompanyAssets(f FGCompanyAssetFilter) ([]model.FGCompanyAsset, int64, error) {
	q := r.db.Model(&model.FGCompanyAsset{}).Where("status = ?", f.Status)
	for key, value := range map[string]string{"kind": f.Kind, "category": f.Category, "brand": f.Brand, "character": f.Character, "style": f.Style} {
		if value != "" {
			q = q.Where(key+" = ?", value)
		}
	}
	if value := strings.TrimSpace(f.Query); value != "" {
		p := "%" + strings.ToLower(value) + "%"
		q = q.Where("LOWER(title) LIKE ? OR LOWER(brand) LIKE ? OR LOWER(character) LIKE ? OR LOWER(style) LIKE ? OR LOWER(note) LIKE ?", p, p, p, p, p)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	rows := []model.FGCompanyAsset{}
	err := q.Order("updated_at desc, id desc").Limit(f.PageSize).Offset((f.Page - 1) * f.PageSize).Find(&rows).Error
	return rows, total, err
}
func (r *Repository) FGCompanyAssetFacets(status string) (map[string]map[string]int64, error) {
	result := map[string]map[string]int64{}
	for _, column := range []string{"kind", "category", "brand", "character", "style"} {
		var rows []struct {
			Value string
			Count int64
		}
		err := r.db.Model(&model.FGCompanyAsset{}).Select(column+" AS value, COUNT(*) AS count").Where("status = ?", status).Group(column).Scan(&rows).Error
		if err != nil {
			return nil, err
		}
		counts := map[string]int64{}
		for _, row := range rows {
			if row.Value != "" {
				counts[row.Value] = row.Count
			}
		}
		result[column] = counts
	}
	return result, nil
}
func (r *Repository) FGCompanyAsset(id string) (*model.FGCompanyAsset, error) {
	var item model.FGCompanyAsset
	err := r.db.First(&item, "id = ?", id).Error
	return &item, err
}
func (r *Repository) CreateFGCompanyAsset(item *model.FGCompanyAsset) error {
	result := r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "resource_id"}}, DoNothing: true}).Create(item)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var stored model.FGCompanyAsset
		if err := r.db.First(&stored, "resource_id = ?", item.ResourceID).Error; err != nil {
			return err
		}
		*item = stored
	}
	return nil
}
func (r *Repository) UpdateFGCompanyAsset(item *model.FGCompanyAsset, expected int64) error {
	result := r.db.Model(&model.FGCompanyAsset{}).Where("id = ? AND revision = ?", item.ID, expected).Updates(map[string]any{"title": item.Title, "category": item.Category, "brand": item.Brand, "character": item.Character, "style": item.Style, "view": item.View, "note": item.Note, "status": item.Status, "revision": expected + 1, "updated_at": item.UpdatedAt})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrFGCompanyAssetConflict
	}
	item.Revision = expected + 1
	return nil
}

// Removing the catalog entry and enqueueing any unreferenced object deletion
// are atomic. A failed inspection leaves the recoverable entry intact.
func (r *Repository) PurgeFGCompanyAsset(id string, expected int64, inspect func(*Repository, *model.FGCompanyAsset) ([]model.Resource, []model.ResourceDeletionJob, error)) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var item model.FGCompanyAsset
		q := tx.Where("id = ?", id)
		if r.Dialect() == "postgres" {
			q = q.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := q.First(&item).Error; err != nil {
			return err
		}
		if item.Revision != expected || item.Status != "archived" {
			return ErrFGCompanyAssetConflict
		}
		if err := tx.Delete(&item).Error; err != nil {
			return err
		}
		resources, jobs, err := inspect(New(tx), &item)
		if err != nil {
			return err
		}
		return New(tx).DeleteDetachedResources(resources, jobs)
	})
}

func (r *Repository) CompanyResourceReferenceOwners() ([]string, error) {
	var ids []string
	err := r.db.Raw(`SELECT id FROM users UNION SELECT user_id FROM resources UNION SELECT user_id FROM assets UNION SELECT user_id FROM canvas_projects UNION SELECT user_id FROM tasks UNION SELECT user_id FROM projects`).Scan(&ids).Error
	return ids, err
}
func fgCompanyReferences(db *gorm.DB) ([]ResourceDirectReference, error) {
	if !fgTeamEnabled() {
		return nil, nil
	}
	var rows []model.FGCompanyAsset
	if err := db.Find(&rows).Error; err != nil {
		return nil, err
	}
	refs := make([]ResourceDirectReference, 0, len(rows))
	for _, item := range rows {
		refs = append(refs, ResourceDirectReference{Kind: "素材", ID: item.ID, Title: "公司素材库 / " + item.Title, ResourceID: item.ResourceID})
	}
	return refs, nil
}
