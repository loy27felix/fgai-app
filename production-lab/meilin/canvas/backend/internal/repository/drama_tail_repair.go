package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"meilin/backend/internal/model"
)

func (r *Repository) CompleteDramaTailRepair(segment model.DramaSegment, job *model.DramaJob, tailID string, seconds int) (bool, error) {
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		updated := tx.Model(&model.DramaSegment{}).
			Where("id = ? AND project_id = ? AND revision = ? AND video_resource_id = ? AND tail_frame_resource_id = '' AND video_status = ? AND video_error = ?",
				segment.ID, segment.ProjectID, segment.Revision, segment.VideoResourceID, model.DramaMediaFailed, segment.VideoError).
			Updates(map[string]any{"tail_frame_resource_id": tailID, "video_seconds": seconds, "video_status": model.DramaMediaReady, "video_error": "", "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		if job == nil {
			return nil
		}
		updated = tx.Model(&model.DramaJob{}).
			Where("id = ? AND project_id = ? AND shot_id = ? AND task_id = ? AND kind = ? AND status = ?",
				job.ID, segment.ProjectID, segment.ID, job.TaskID, model.DramaJobSegmentVideo, model.DramaJobFailed).
			Updates(map[string]any{"status": model.DramaJobSucceeded, "error": "", "finished_at": now, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		return nil
	})
	if errors.Is(err, ErrTaskStateConflict) {
		return false, nil
	}
	return err == nil, err
}
