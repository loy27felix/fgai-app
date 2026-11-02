package database

import (
	"encoding/json"
	"os"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestFG150MigrationKeepsLegacyChapterAndShots(t *testing.T) {
	config := Config{Driver: "sqlite", DSN: "file:fg150-fixture?mode=memory&cache=shared"}
	if dsn := os.Getenv("FG150_TEST_POSTGRES_DSN"); dsn != "" {
		config = Config{Driver: "postgres", DSN: dsn}
	}
	db, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, m := range schemaMigrations {
		if m.version > 64 {
			break
		}
		if err := m.apply(db); err != nil {
			t.Fatalf("migration %d: %v", m.version, err)
		}
		if err := db.Create(&schemaMigration{Version: m.version, Name: m.name, Checksum: m.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	chapter := model.ProjectUnit{ID: "legacy-chapter", ProjectID: "legacy-project", Title: "Episode 3", SourceText: "Original bilingual dialogue stays verbatim", Position: 3}
	// A real schema-64 installation has none of these new upstream tables.
	for _, entity := range []any{&model.DramaProduction{}, &model.DramaCast{}, &model.DramaEpisode{}, &model.DramaShot{}, &model.DramaTake{}, &model.DramaSegment{}, &model.DramaJob{}, &model.ResourceOffloadJob{}, &model.UserStorageGrant{}, &model.UserStorageState{}} {
		if err := db.Migrator().DropTable(entity); err != nil {
			t.Fatal(err)
		}
	}
	shot := model.Shot{ID: "legacy-shot", ProjectID: chapter.ProjectID, UnitID: chapter.ID, CurrentRevisionID: "legacy-revision", Title: "Shot 1", DurationMs: 13000}
	if err := db.Create(&chapter).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&shot).Error; err != nil {
		t.Fatal(err)
	}
	var ledger []schemaMigration
	db.Order("version").Find(&ledger)
	before, _ := json.Marshal(ledger)
	for i := 0; i < 2; i++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var afterLedger []schemaMigration
	db.Where("version <= 64").Order("version").Find(&afterLedger)
	after, _ := json.Marshal(afterLedger)
	if string(before) != string(after) {
		t.Fatal("FG historical migration ledger changed")
	}
	var gotChapter model.ProjectUnit
	var gotShot model.Shot
	if err := db.First(&gotChapter, "id = ?", chapter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&gotShot, "id = ?", shot.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotChapter.SourceText != chapter.SourceText || gotShot.CurrentRevisionID != shot.CurrentRevisionID || gotShot.UnitID != chapter.ID || gotShot.DurationMs != shot.DurationMs {
		t.Fatal("legacy chapter or shot changed")
	}
	for _, entity := range []any{&model.DramaProduction{}, &model.DramaSegment{}, &model.ResourceOffloadJob{}, &model.UserStorageGrant{}} {
		if !db.Migrator().HasTable(entity) {
			t.Fatalf("missing new table %T", entity)
		}
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}
