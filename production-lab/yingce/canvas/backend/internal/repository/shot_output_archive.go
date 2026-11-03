package repository

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

var ErrProjectUnitShotsGenerating = errors.New("章节镜头仍有生成任务运行")

// Replacing a chapter must not detach already generated media from its shots.
// Copy only this chapter's domain records, reusing the existing resource IDs;
// this is a visible project chapter, not a database or media-file backup.
func archiveProjectUnitOutputsTx(tx *gorm.DB, projectID, unitID string) error {
	var active int64
	if err := tx.Table("production_task_links").Joins("JOIN tasks ON tasks.id = production_task_links.task_id").Where("production_task_links.project_id = ? AND production_task_links.unit_id = ? AND production_task_links.shot_id IN (SELECT id FROM shots WHERE project_id = ? AND unit_id = ?) AND tasks.status IN ?", projectID, unitID, projectID, unitID, []string{"queued", "running"}).Count(&active).Error; err != nil {
		return err
	}
	if active > 0 {
		return ErrProjectUnitShotsGenerating
	}
	var artifacts []model.ShotArtifact
	if err := tx.Where("project_id = ? AND unit_id = ?", projectID, unitID).Find(&artifacts).Error; err != nil || len(artifacts) == 0 {
		return err
	}
	var source model.ProjectUnit
	if err := tx.First(&source, "id = ? AND project_id = ?", unitID, projectID).Error; err != nil {
		return err
	}
	var shots []model.Shot
	if err := tx.Where("project_id = ? AND unit_id = ?", projectID, unitID).Order("position asc").Find(&shots).Error; err != nil {
		return err
	}
	if len(shots) == 0 {
		return nil
	}
	var maxPosition int
	if err := tx.Model(&model.ProjectUnit{}).Where("project_id = ?", projectID).Select("COALESCE(MAX(position), 0)").Scan(&maxPosition).Error; err != nil {
		return err
	}
	now := time.Now()
	archive := source
	archive.ID = uuid.NewString()
	title := []rune("成品保留 · " + source.Title)
	if len(title) > 240 {
		title = title[:240]
	}
	archive.Title = string(title)
	archive.Position, archive.CreatedAt, archive.UpdatedAt = maxPosition+1, now, now
	if err := tx.Create(&archive).Error; err != nil {
		return err
	}
	shotIDs := make([]string, 0, len(shots))
	shotMap := make(map[string]string, len(shots))
	for _, shot := range shots {
		shotIDs = append(shotIDs, shot.ID)
		shotMap[shot.ID] = uuid.NewString()
	}
	var revisions []model.ShotRevision
	if err := tx.Where("shot_id IN ?", shotIDs).Find(&revisions).Error; err != nil {
		return err
	}
	revisionMap := make(map[string]string, len(revisions))
	for i := range revisions {
		revisionMap[revisions[i].ID] = uuid.NewString()
		revisions[i].ID, revisions[i].ShotID = revisionMap[revisions[i].ID], shotMap[revisions[i].ShotID]
	}
	for i := range shots {
		shots[i].ID, shots[i].UnitID, shots[i].CurrentRevisionID = shotMap[shots[i].ID], archive.ID, revisionMap[shots[i].CurrentRevisionID]
	}
	if err := tx.Create(&shots).Error; err != nil {
		return err
	}
	if len(revisions) > 0 {
		if err := tx.Create(&revisions).Error; err != nil {
			return err
		}
	}
	var references []model.ShotAssetReference
	if err := tx.Where("shot_id IN ?", shotIDs).Find(&references).Error; err != nil {
		return err
	}
	for i := range references {
		references[i].ID, references[i].ShotID = uuid.NewString(), shotMap[references[i].ShotID]
	}
	if len(references) > 0 {
		if err := tx.Create(&references).Error; err != nil {
			return err
		}
	}
	for i := range artifacts {
		// Ignore already orphaned historical records; never attach them by number.
		if shotMap[artifacts[i].ShotID] == "" {
			continue
		}
		artifact := artifacts[i]
		artifact.ID, artifact.UnitID, artifact.ShotID = uuid.NewString(), archive.ID, shotMap[artifact.ShotID]
		artifact.RevisionID = revisionMap[artifact.RevisionID]
		if err := tx.Create(&artifact).Error; err != nil {
			return err
		}
	}
	var links []model.ProductionTaskLink
	if err := tx.Where("project_id = ? AND shot_id IN ?", projectID, shotIDs).Find(&links).Error; err != nil {
		return err
	}
	for i := range links {
		links[i].ID, links[i].UnitID, links[i].ShotID = uuid.NewString(), archive.ID, shotMap[links[i].ShotID]
		// The new chapter gets its own workflow when opened; the source workflow
		// remains attached to the chapter being replaced.
		links[i].WorkflowStepID = ""
	}
	if len(links) > 0 {
		return tx.Create(&links).Error
	}
	return nil
}
