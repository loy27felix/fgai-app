package database

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestFG156MigrationFrom75PreservesExistingWork(t *testing.T) {
	config := Config{Driver: "sqlite", DSN: "file:fg156-upgrade?mode=memory&cache=shared"}
	if dsn := os.Getenv("FG156_TEST_POSTGRES_DSN"); dsn != "" {
		config = Config{Driver: "postgres", DSN: dsn}
	}
	db, err := Open(config)
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	defer connection.Close()
	if err = db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 75 {
			break
		}
		if err = item.apply(db); err != nil {
			t.Fatal(err)
		}
		if err = db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Current baseline structs contain new fields; restore a real schema75 shape.
	for _, entity := range []any{&model.ReferralProfile{}, &model.ReferralBinding{}, &model.ReferralCommission{}} {
		if err = db.Migrator().DropTable(entity); err != nil {
			t.Fatal(err)
		}
	}
	for _, column := range []struct {
		model any
		field string
	}{{&model.User{}, "IsPromoter"}, {&model.DramaEpisode{}, "SourceFormat"}, {&model.DramaSegment{}, "ReferenceCastIDsJSON"}} {
		if err = db.Migrator().DropColumn(column.model, column.field); err != nil {
			t.Fatal(err)
		}
	}
	chapter := model.ProjectUnit{ID: "fg156-chapter", ProjectID: "fg156-project", SourceText: "Original English dialogue", Title: "Keep chapter"}
	shot := model.Shot{ID: "fg156-shot", ProjectID: chapter.ProjectID, UnitID: chapter.ID, CurrentRevisionID: "fg156-revision", DurationMs: 15000}
	revision := model.ShotRevision{ID: shot.CurrentRevisionID, ShotID: shot.ID, VideoPrompt: "Keep reviewed video prompt", Dialogue: "Ella: Original words.", ActionBeatsJSON: `[{"kind":"character_costume_timeline","assetId":"actor","segments":[]}]`}
	// Insert the old rows without querying columns that have not been migrated.
	if err = db.Table("users").Create(map[string]any{"id": "fg156-user", "username": "fg156-user", "status": "active", "role": "user"}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Table("drama_episodes").Create(map[string]any{"id": "fg156-episode", "project_id": chapter.ProjectID, "number": 1, "revision": 7}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Table("drama_segments").Create(map[string]any{"id": "fg156-segment", "project_id": chapter.ProjectID, "episode_id": "fg156-episode", "segment_index": 1, "video_prompt_override": "Keep override"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, entity := range []any{&chapter, &shot, &revision} {
		if err = db.Create(entity).Error; err != nil {
			t.Fatal(err)
		}
	}
	var ledger []schemaMigration
	db.Order("version").Find(&ledger)
	before, _ := json.Marshal(ledger)
	for i := 0; i < 2; i++ {
		if err = MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var history []schemaMigration
	db.Where("version <= 75").Order("version").Find(&history)
	after, _ := json.Marshal(history)
	if string(before) != string(after) {
		t.Fatal("historical migration identities changed")
	}
	var gotChapter model.ProjectUnit
	var gotRevision model.ShotRevision
	var user model.User
	var episode model.DramaEpisode
	var segment model.DramaSegment
	for _, record := range []struct {
		value any
		id    string
	}{{&gotChapter, chapter.ID}, {&gotRevision, revision.ID}, {&user, "fg156-user"}, {&episode, "fg156-episode"}, {&segment, "fg156-segment"}} {
		if err = db.First(record.value, "id = ?", record.id).Error; err != nil {
			t.Fatal(err)
		}
	}
	if gotChapter.SourceText != chapter.SourceText || gotRevision.VideoPrompt != revision.VideoPrompt || gotRevision.Dialogue != revision.Dialogue || gotRevision.ActionBeatsJSON != revision.ActionBeatsJSON {
		t.Fatal("existing FG creative work changed")
	}
	if user.IsPromoter || episode.SourceFormat != "" || episode.Revision != 7 || segment.ReferenceCastIDsJSON != "" {
		t.Fatal("new fields changed old meaning")
	}
	for _, entity := range []any{&model.ReferralProfile{}, &model.ReferralBinding{}, &model.ReferralCommission{}} {
		if !db.Migrator().HasTable(entity) {
			t.Fatal("new table missing")
		}
	}
	if err = RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}
