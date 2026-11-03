package app

import (
	"encoding/json"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestFGChapterSubmissionIdentityScopesRetriesWithoutBypassingAdmission(t *testing.T) {
	request := CreateTaskRequest{ProjectID: "project", Type: "canvas_text", Operation: "storyboard", Input: map[string]any{"metadata": map[string]any{"source": "short-drama-chapter-storyboard", "chapterId": "chapter", "storyboardBatchId": "batch", "batchIndex": 11, "batchCount": 18, "storyboardSubmissionKey": "batch:11"}}}
	id := chapterSubmissionTaskID("user-1", request)
	if len(id) != 32 || id != chapterSubmissionTaskID("user-1", request) || id == chapterSubmissionTaskID("user-2", request) {
		t.Fatal("missing-part retry identity is not stable and account scoped")
	}
	encoded, _ := json.Marshal(request)
	var decoded CreateTaskRequest
	if err := json.Unmarshal(encoded, &decoded); err != nil || chapterSubmissionTaskID("user-1", decoded) != id {
		t.Fatal("JSON-number batch identity changed")
	}
	decoded.ProjectID = "other-project"
	if chapterSubmissionTaskID("user-1", decoded) == id {
		t.Fatal("project scope collision")
	}
	request.Input["metadata"].(map[string]any)["batchIndex"] = 11.5
	if chapterSubmissionTaskID("user-1", request) != "" {
		t.Fatal("fractional batch index accepted")
	}
	request.Input["metadata"].(map[string]any)["batchIndex"] = 11
	request.Input["metadata"].(map[string]any)["storyboardRepairOf"] = "original-task"
	if chapterSubmissionTaskID("user-1", request) != "" {
		t.Fatal("automatic repair reused the original submission identity")
	}
}

func TestFGChapterRepeatedSubmissionReturnsOnlyTheOriginalOwnedTask(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	request := CreateTaskRequest{ProjectID: project.ID, Type: "canvas_text", Operation: "storyboard", Prompt: "original", Input: map[string]any{"metadata": map[string]any{"source": "short-drama-chapter-storyboard", "chapterId": unit.ID, "storyboardBatchId": "batch", "batchIndex": 1, "batchCount": 2, "storyboardSubmissionKey": "batch:1"}}}
	id := chapterSubmissionTaskID("user-1", request)
	original := model.Task{ID: id, UserID: "user-1", ProjectID: project.ID, Type: "canvas_text", Status: model.TaskStatusSucceeded, Prompt: "original", ResultJSON: `{"text":"saved result"}`}
	if err := db.Create(&original).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		got, err := service.CreateTask("user-1", request)
		if err != nil || got.ID != id || got.ResultJSON != original.ResultJSON {
			t.Fatalf("repeat did not return original result: %v", err)
		}
	}
	if _, err := service.CreateTask("another-user", request); err == nil {
		t.Fatal("another user read an existing task")
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatal("repeat created a new task")
	}
}

func TestFGChapterReplacementPreservesGeneratedShotsAndVideoHistory(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	old, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "原镜头01", Description: "原画面", Revision: ShotRevisionInput{VideoPrompt: "原始提示词", Dialogue: "Original line."}})
	if err != nil {
		t.Fatal(err)
	}
	reference := model.ShotAssetReference{ID: newID(), ShotID: old.ID, AssetVersionID: "character-version", Role: "reference", Status: "linked", CreatedAt: time.Now()}
	if err := db.Create(&reference).Error; err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 2; i++ {
		taskID := newID()
		artifact := model.ShotArtifact{ID: newID(), ProjectID: project.ID, UnitID: unit.ID, ShotID: old.ID, RevisionID: old.CurrentRevisionID, TaskID: taskID, ResourceID: "original-resource", Type: "video", Status: "ready", Version: i, Selected: i == 2, MetadataJSON: `{"actualPrompt":"original submitted prompt"}`}
		link := model.ProductionTaskLink{ID: newID(), TaskID: taskID, ProjectID: project.ID, UnitID: unit.ID, ShotID: old.ID, ArtifactType: "video"}
		for _, item := range []any{&artifact, &link} {
			if err := db.Create(item).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	shots, err := service.ReplaceProjectUnitShots("user-1", project.ID, unit.ID, ReplaceProjectUnitShotsRequest{ExpectedShotIDs: []string{old.ID}, Shots: []ReplaceProjectUnitShotInput{{CreateProjectShotRequest: CreateProjectShotRequest{Title: "新镜头", Description: "新画面", Revision: ShotRevisionInput{VideoPrompt: "新提示词"}}}}})
	if err != nil || len(shots) != 1 {
		t.Fatalf("replacement: %v", err)
	}
	var archive model.ProjectUnit
	if err := db.Where("project_id = ? AND id <> ?", project.ID, unit.ID).First(&archive).Error; err != nil {
		t.Fatal(err)
	}
	if archive.SourceText != unit.SourceText || archive.Title != "成品保留 · "+unit.Title {
		t.Fatal("archive did not preserve the original chapter")
	}
	var preserved model.Shot
	if err := db.First(&preserved, "unit_id = ?", archive.ID).Error; err != nil {
		t.Fatal(err)
	}
	var revision model.ShotRevision
	db.First(&revision, "id = ?", preserved.CurrentRevisionID)
	if revision.VideoPrompt != "原始提示词" || revision.Dialogue != "Original line." || preserved.ID == old.ID {
		t.Fatal("original script was lost or attached to the new shot")
	}
	var artifacts []model.ShotArtifact
	db.Where("unit_id = ?", archive.ID).Order("version asc").Find(&artifacts)
	if len(artifacts) != 2 || artifacts[0].Selected || !artifacts[1].Selected {
		t.Fatal("video history or selected version lost")
	}
	for _, artifact := range artifacts {
		if artifact.ResourceID != "original-resource" || artifact.ShotID != preserved.ID || artifact.RevisionID != revision.ID || artifact.MetadataJSON != `{"actualPrompt":"original submitted prompt"}` {
			t.Fatal("media identity, prompt or shot association changed")
		}
	}
	for _, table := range []any{&model.ShotAssetReference{}, &model.ProductionTaskLink{}} {
		var count int64
		db.Model(table).Where("shot_id = ?", preserved.ID).Count(&count)
		if count == 0 {
			t.Fatal("preserved shot lost asset or task references")
		}
	}
	var freshArtifactCount int64
	db.Model(&model.ShotArtifact{}).Where("unit_id = ?", unit.ID).Count(&freshArtifactCount)
	if freshArtifactCount != 0 {
		t.Fatal("new shots inherited videos from a different script")
	}
}

func TestFGChapterOutputArchiveRollsBackWithFailedReplacement(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	old, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "原镜头", Description: "原画面"})
	if err != nil {
		t.Fatal(err)
	}
	artifact := model.ShotArtifact{ID: newID(), ProjectID: project.ID, UnitID: unit.ID, ShotID: old.ID, RevisionID: old.CurrentRevisionID, TaskID: newID(), ResourceID: "original-resource", Type: "video", Version: 1}
	if err := db.Create(&artifact).Error; err != nil {
		t.Fatal(err)
	}
	duplicate := model.Shot{ID: newID(), ProjectID: project.ID, UnitID: unit.ID, Title: "invalid duplicate"}
	if err := service.repo.ReplaceProjectUnitShots(project.ID, unit.ID, []model.Shot{duplicate, duplicate}, nil, nil, []string{old.ID}); err == nil {
		t.Fatal("expected duplicate insert to fail")
	}
	var units, outputs, originals int64
	db.Model(&model.ProjectUnit{}).Where("project_id = ?", project.ID).Count(&units)
	db.Model(&model.ShotArtifact{}).Where("id = ? AND shot_id = ?", artifact.ID, old.ID).Count(&outputs)
	db.Model(&model.Shot{}).Where("id = ? AND current_revision_id = ?", old.ID, old.CurrentRevisionID).Count(&originals)
	if units != 1 || outputs != 1 || originals != 1 {
		t.Fatal("failed replacement partially archived or removed original data")
	}
}

func TestFGChapterReplacementWaitsForExistingMediaGeneration(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	old, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "原镜头", Description: "原画面"})
	if err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: newID(), UserID: "user-1", ProjectID: project.ID, Status: model.TaskStatusRunning}
	link := model.ProductionTaskLink{ID: newID(), TaskID: task.ID, ProjectID: project.ID, UnitID: unit.ID, ShotID: old.ID, ArtifactType: "video"}
	for _, item := range []any{&task, &link} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	_, err = service.ReplaceProjectUnitShots("user-1", project.ID, unit.ID, ReplaceProjectUnitShotsRequest{ExpectedShotIDs: []string{old.ID}, Shots: []ReplaceProjectUnitShotInput{{CreateProjectShotRequest: CreateProjectShotRequest{Title: "新镜头", Description: "新画面"}}}})
	if err == nil {
		t.Fatal("replacement detached an active video task")
	}
	var originals int64
	db.Model(&model.Shot{}).Where("id = ?", old.ID).Count(&originals)
	if originals != 1 {
		t.Fatal("active task's original shot was removed")
	}
}
