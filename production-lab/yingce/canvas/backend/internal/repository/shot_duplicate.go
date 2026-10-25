package repository

import (
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm/clause"

	"yingce/backend/internal/model"
)

// Copy only editable script and references. Generated artifacts continue to belong to the source.
func (r *Repository) DuplicateShotWithRevision(shot *model.Shot, revision *model.ShotRevision, sourceID string) error {
	return r.Transaction(func(tx *Repository) error {
		var project model.Project
		if err := tx.db.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&project, "id = ?", shot.ProjectID).Error; err != nil {
			return err
		}
		source, err := tx.ShotForProject(shot.ProjectID, sourceID)
		if err != nil {
			return err
		}
		if source.UnitID != shot.UnitID {
			return fmt.Errorf("原镜头章节已变化，请刷新后复制")
		}
		var position int
		if err := tx.db.Model(&model.Shot{}).Where("project_id = ? AND unit_id = ?", shot.ProjectID, shot.UnitID).Select("COALESCE(MAX(position), -1) + 1").Scan(&position).Error; err != nil {
			return err
		}
		shot.Position = position
		var references []model.ShotAssetReference
		if err := tx.db.Where("shot_id = ? AND status = ?", sourceID, "linked").Order("created_at asc, id asc").Find(&references).Error; err != nil {
			return err
		}
		if err := tx.SaveShotWithRevision(shot, revision, true); err != nil {
			return err
		}
		for _, reference := range references {
			var linked int64
			if err := tx.db.Table("asset_versions av").Joins("JOIN project_asset_links pal ON pal.asset_id = av.asset_id").Where("pal.project_id = ? AND av.id = ?", shot.ProjectID, reference.AssetVersionID).Count(&linked).Error; err != nil {
				return err
			}
			if linked == 0 {
				return fmt.Errorf("原镜头引用的资产已移除，请重新核对后复制")
			}
			reference.ID = uuid.NewString()
			reference.ShotID = shot.ID
			if err := tx.UpsertShotAssetReference(&reference); err != nil {
				return err
			}
		}
		return nil
	})
}
