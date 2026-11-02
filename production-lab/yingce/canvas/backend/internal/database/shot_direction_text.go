package database

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func migrateShotDirectionText(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.ShotRevision{}) {
		return tx.AutoMigrate(&model.ShotRevision{})
	}
	if tx.Dialector.Name() == "postgres" {
		return tx.Exec(`ALTER TABLE shot_revisions
			ALTER COLUMN shot_size TYPE text,
			ALTER COLUMN camera_angle TYPE text,
			ALTER COLUMN camera_movement TYPE text`).Error
	}
	for _, field := range []string{"ShotSize", "CameraAngle", "CameraMovement"} {
		if err := tx.Migrator().AlterColumn(&model.ShotRevision{}, field); err != nil {
			return err
		}
	}
	return nil
}
