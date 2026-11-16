package app

import (
	"strings"
	"testing"

	"meilin/backend/internal/model"
)

func TestDramaSegmentInputModesSendOnlySelectedMedia(t *testing.T) {
	svc, fake := newDramaTestService(t)
	video := dramaVideoFixture()
	video.References.MaxAudios = 1
	setDramaVideoCapability(t, svc, fake, video)
	owner := "usr-drama"
	first := fake.resource(owner, "image", "image/png")
	last := fake.resource(owner, "image", "image/png")
	image := fake.resource(owner, "image", "image/png")
	voice := fake.resource(owner, "audio", "audio/wav")
	previous := &model.DramaSegment{ID: "previous", VideoStatus: model.DramaMediaFailed}
	settings := DramaSettings{Models: fakeDramaModels}
	settings.AspectRatio = "9:16"
	draft := dramaSegmentDraft{view: DramaSegmentView{
		Index: 1, DurationMs: 5000,
		Request: DramaSegmentRequest{References: []DramaSegmentReference{
			{CastID: "hero", Name: "主角", Label: "参考图1"},
			{ResourceID: image, Name: "厨房", Label: "参考图2"},
		}},
	}}
	casts := map[string]model.DramaCast{"hero": {ID: "hero", Kind: "character", Name: "主角", VoiceSampleResourceID: voice}}
	segment := model.DramaSegment{SegmentIndex: 1, VideoPrompt: "主角（参考图1）走进厨房（参考图2）", AudioCastIDsJSON: `["hero"]`, VideoInputMode: model.DramaVideoInputReference}
	request, refs, audios, err := svc.prepareDramaSegment(settings, draft, segment, previous, casts)
	if err != nil || request.Operation != "reference_to_video" || request.FirstFramePending || len(refs) != 1 || len(audios) != 1 {
		t.Fatalf("reference request: %+v; %v; %v; %v", request, refs, audios, err)
	}
	if request.SubmissionPrompt != "主角走进厨房（参考图1）" || refs[0].(map[string]any)["id"] != "参考图1" {
		t.Fatalf("provider numbered the wrong image: %+v", request)
	}
	segment.VideoInputMode = model.DramaVideoInputFrames
	segment.FirstFrameResourceID, segment.LastFrameResourceID = first, last
	request, refs, audios, err = svc.prepareDramaSegment(settings, draft, segment, previous, casts)
	if err != nil || request.Operation != "image_to_video" || request.FirstFramePending || len(refs) != 2 || len(audios) != 0 {
		t.Fatalf("frame request: %+v; %v; %v; %v", request, refs, audios, err)
	}
	if refs[0].(map[string]any)["role"] != "first_frame" || refs[1].(map[string]any)["role"] != "last_frame" || strings.Contains(request.SubmissionPrompt, "参考图") {
		t.Fatalf("unexpected frame media or prompt: %+v; %v", request, refs)
	}
	segment.FirstFrameResourceID = ""
	request, _, _, err = svc.prepareDramaSegment(settings, draft, segment, previous, casts)
	if err != nil || !request.FirstFramePending {
		t.Fatalf("expected wait for previous tail: %+v; %v", request, err)
	}
}

func TestDramaRemoveAndReorderReferencesKeepsPromptBindings(t *testing.T) {
	svc, fake := newDramaTestService(t)
	summary := createTestDramaWithMedia(t, svc, DramaReviewAuto, DramaMediaManual)
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 20)
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episodeID := summary.Episodes[0].ID
	rows, err := svc.repo.DramaSegments(episodeID)
	if err != nil || len(rows) == 0 {
		t.Fatalf("missing segments: %v", err)
	}
	current := rows[0]
	none := []string{}
	images := []model.DramaReferenceImage{
		{ResourceID: fake.resource("usr-drama", "image", "image/png"), Name: "客厅"},
		{ResourceID: fake.resource("usr-drama", "image", "image/png"), Name: "红球"},
		{ResourceID: fake.resource("usr-drama", "image", "image/png"), Name: "厨房"},
	}
	if err := svc.UpdateDramaSegment("usr-drama", project, episodeID, current.SegmentIndex, UpdateDramaSegmentRequest{ReferenceCastIDs: &none, ReferenceImages: &images}); err != nil {
		t.Fatal(err)
	}
	prompt := "走出客厅（参考图1），捡起红球（参考图2），走进厨房（参考图3），然后回到参考图1。"
	if err := fake.db.Model(&current).Updates(map[string]any{"video_prompt": prompt, "video_prompt_override": "手写：" + prompt, "prompt_status": model.DramaMediaReady}).Error; err != nil {
		t.Fatal(err)
	}
	reordered := []model.DramaReferenceImage{images[2], images[0]}
	if err := svc.UpdateDramaSegment("usr-drama", project, episodeID, current.SegmentIndex, UpdateDramaSegmentRequest{ReferenceImages: &reordered}); err != nil {
		t.Fatal(err)
	}
	saved, err := svc.repo.DramaSegment(project, current.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := "走出客厅（参考图2），捡起红球，走进厨房（参考图1），然后回到参考图2。"
	if saved.VideoPrompt != want || saved.VideoPromptOverride != "手写："+want || saved.PromptStatus != model.DramaMediaReady {
		t.Fatalf("wrong prompt binding/status: %+v", saved)
	}
	if err := svc.UpdateDramaSegment("usr-drama", project, episodeID, current.SegmentIndex, UpdateDramaSegmentRequest{Revision: &current.Revision, ReferenceImages: &images}); err == nil {
		t.Fatal("stale editor should not overwrite the current reference order")
	}
}
