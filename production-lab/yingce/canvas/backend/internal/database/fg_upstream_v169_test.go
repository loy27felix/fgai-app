package database

import (
	"os"
	"testing"

	"yingce/backend/internal/model"
)

func TestFGUpstreamV169PostgresMigration(t *testing.T) {
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
	var before string
	query := "SELECT string_agg(version::text || ':' || name || ':' || checksum, ',' ORDER BY version) FROM schema_migrations WHERE version <= 58"
	if err := db.Raw(query).Scan(&before).Error; err != nil {
		t.Fatal(err)
	}
	lesson := model.AgentLesson{ID: "legacy-v58", AuthorUserID: "owner", Topic: "keep", Status: model.AgentLessonStatusApproved, Source: "original evidence"}
	if err := db.Create(&lesson).Error; err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"DROP TABLE agent_memory_proposals, agent_memory_revisions",
		"ALTER TABLE agent_memory_settings DROP COLUMN compact_proposal_id, DROP COLUMN compact_cursor",
		"ALTER TABLE channel_models ALTER COLUMN protocol TYPE varchar(32)",
		"DELETE FROM schema_migrations WHERE version IN (59,60)",
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	var after string
	if err := db.Raw(query).Scan(&after).Error; err != nil || before != after {
		t.Fatalf("legacy migration identities changed: %v", err)
	}
	for _, table := range []any{&model.AgentMemoryProposal{}, &model.AgentMemoryRevision{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table %T", table)
		}
	}
	var width int
	if err := db.Raw("SELECT character_maximum_length FROM information_schema.columns WHERE table_name='channel_models' AND column_name='protocol'").Scan(&width).Error; err != nil || width != 64 {
		t.Fatalf("protocol width=%d error=%v", width, err)
	}
	var preserved model.AgentLesson
	if err := db.First(&preserved, "id = ?", lesson.ID).Error; err != nil || preserved.Source != lesson.Source || preserved.Status != lesson.Status {
		t.Fatalf("existing memory changed: %v", err)
	}
}
