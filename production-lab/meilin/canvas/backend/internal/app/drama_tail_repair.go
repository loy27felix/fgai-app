package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"meilin/backend/internal/model"
)

type DramaTailRepairReport struct {
	Matched   int `json:"matched"`
	Eligible  int `json:"eligible"`
	Recovered int `json:"recovered"`
	Skipped   int `json:"skipped"`
	Failed    int `json:"failed"`
}

// RepairDramaMissingFFmpeg repairs only existing videos affected by the missing
// executable. It never starts the production scheduler or submits model jobs.
func (s *Service) RepairDramaMissingFFmpeg(ctx context.Context, projectID string, apply bool, progress io.Writer) (DramaTailRepairReport, error) {
	var report DramaTailRepairReport
	production, err := s.repo.DramaProduction(projectID)
	if err != nil {
		return report, err
	}
	if apply {
		if _, err := renderFfmpegBinary(); err != nil {
			return report, err
		}
	}
	episodes, err := s.repo.DramaEpisodes(projectID)
	if err != nil {
		return report, err
	}
	for _, episode := range episodes {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		rows, err := s.repo.DramaSegments(episode.ID)
		if err != nil {
			return report, err
		}
		jobs, err := s.repo.RecentDramaSegmentJobs(projectID, episode.ID)
		if err != nil {
			return report, err
		}
		latestVideo := make(map[string]model.DramaJob)
		for _, job := range jobs {
			if job.Kind == model.DramaJobSegmentVideo {
				if _, exists := latestVideo[job.ShotID]; !exists {
					latestVideo[job.ShotID] = job
				}
			}
		}
		for _, segment := range rows {
			if err := ctx.Err(); err != nil {
				return report, err
			}
			if segment.VideoStatus != model.DramaMediaFailed || !strings.Contains(segment.VideoError, "后端未安装 ffmpeg") {
				continue
			}
			report.Matched++
			resource, err := s.repo.ResourceForUser(production.UserID, segment.VideoResourceID)
			if err != nil || resource == nil || segment.TailFrameResourceID != "" || !strings.HasPrefix(resource.MimeType, "video/") {
				report.Skipped++
				continue
			}
			var failedJob *model.DramaJob
			job := latestVideo[segment.ID]
			if job.Status == model.DramaJobQueued || job.Status == model.DramaJobRunning {
				report.Skipped++
				continue
			}
			if !adoptedDramaVideoNeedsReprocessing(segment.VideoStatus, segment.VideoResourceID, segment.VideoError) {
				task, taskErr := s.repo.TaskForUser(production.UserID, job.TaskID)
				var request dramaRevisionPayload
				if !dramaVideoJobReplayable(job) || taskErr != nil || task == nil || task.Status != model.TaskStatusSucceeded ||
					dramaTaskResource(task) != segment.VideoResourceID || json.Unmarshal([]byte(job.PayloadJSON), &request) != nil ||
					request.Revision != segment.Revision {
					report.Skipped++
					continue
				}
				failedJob = &job
			}
			report.Eligible++
			if !apply {
				continue
			}
			release, acquired := s.acquireDramaTailLease(segment.VideoResourceID)
			if !acquired {
				report.Skipped++
				continue
			}
			recovered, repairErr := s.repairExistingDramaTail(production.UserID, segment, failedJob, resource)
			release()
			switch {
			case repairErr != nil:
				report.Failed++
			case recovered:
				report.Recovered++
			default:
				report.Skipped++
			}
		}
		if apply && progress != nil {
			_ = json.NewEncoder(progress).Encode(report)
		}
	}
	return report, nil
}

func (s *Service) repairExistingDramaTail(userID string, segment model.DramaSegment, job *model.DramaJob, resource *model.Resource) (bool, error) {
	facts, err := s.inspectDramaVideo(userID, resource)
	if err != nil {
		return false, err
	}
	seconds := segment.VideoSeconds
	if facts.DurationMs > 0 {
		seconds = int((facts.DurationMs + 999) / 1000)
	}
	if seconds <= 0 || facts.TailResourceID == "" {
		return false, errors.New("无法读取视频时长或尾帧")
	}
	return s.repo.CompleteDramaTailRepair(segment, job, facts.TailResourceID, seconds)
}
