package database

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestShotDirectionTextMigrationSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "direction.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.Exec(`CREATE TABLE shot_revisions (id text PRIMARY KEY, shot_size varchar(80), camera_angle varchar(80), camera_movement varchar(120))`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO shot_revisions VALUES ('old', '中景', '平视', '后退')`).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := db.Transaction(migrateShotDirectionText); err != nil {
			t.Fatal(err)
		}
	}
	assertShotDirectionText(t, db)
	var old struct{ CameraAngle string }
	if err := db.Table("shot_revisions").Where("id = ?", "old").First(&old).Error; err != nil || old.CameraAngle != "平视" {
		t.Fatalf("old row lost: %+v, %v", old, err)
	}
}

// Only use an explicitly supplied disposable database, never a developer's or
// production DATABASE_URL. The migration test intentionally recreates v57 limits.
func TestShotDirectionTextMigrationPostgres(t *testing.T) {
	dsn := os.Getenv("FG_TEST_SHOT_DIRECTION_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("disposable PostgreSQL not configured")
	}
	db, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`ALTER TABLE shot_revisions ALTER COLUMN shot_size TYPE varchar(80), ALTER COLUMN camera_angle TYPE varchar(80), ALTER COLUMN camera_movement TYPE varchar(120)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DELETE FROM schema_migrations WHERE version = 58`).Error; err != nil {
		t.Fatal(err)
	}
	old := model.ShotRevision{ID: "old-direction", ShotID: "shot", Version: 1, CameraAngle: "平视"}
	if err := db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	long := strings.Repeat("摄影机保持真实通道与演员的空间关系。", 20)
	if err := db.Model(&model.ShotRevision{}).Where("id = ?", old.ID).Update("camera_angle", long).Error; err == nil {
		t.Fatal("legacy PostgreSQL limit did not reproduce")
	}
	for i := 0; i < 2; i++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	assertShotDirectionText(t, db)
	var saved model.ShotRevision
	if err := db.First(&saved, "id = ?", old.ID).Error; err != nil || saved.CameraAngle != old.CameraAngle {
		t.Fatalf("old row lost: %v", err)
	}
	if err := db.Model(&saved).Updates(map[string]any{"shot_size": long, "camera_angle": long, "camera_movement": long}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&saved, "id = ?", old.ID).Error; err != nil || saved.ShotSize != long || saved.CameraAngle != long || saved.CameraMovement != long {
		t.Fatalf("direction truncated: %v", err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("schema status: %+v, %v", status, err)
	}
}

func assertShotDirectionText(t *testing.T, db *gorm.DB) {
	t.Helper()
	columns, err := db.Migrator().ColumnTypes(&model.ShotRevision{})
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"shot_size", "camera_angle", "camera_movement"} {
		found := false
		for _, column := range columns {
			if column.Name() == field {
				found = true
				if strings.ToLower(column.DatabaseTypeName()) != "text" {
					t.Errorf("%s remains %s", field, column.DatabaseTypeName())
				}
			}
		}
		if !found {
			t.Errorf("missing %s", field)
		}
	}
}
