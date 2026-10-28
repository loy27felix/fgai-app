package production

import "testing"

func TestFG156StoryboardImportKeepsOriginalDialogue(t *testing.T) {
	line := "Why the hell is Chloe's name on my track?"
	for name, source := range map[string]string{
		"json":        `{"shots":[{"scene":"Backstage","characters":["Ella"],"speaker":"Ella","dialogue":"Why the hell is Chloe's name on my track?","action":"Hold the poster","durationSeconds":12}]}`,
		"markdown":    "| Scene | Characters | Speaker | Dialogue | Action | Duration |\n|---|---|---|---|---|---|\n| Backstage | Ella | Ella | Why the hell is Chloe's name on my track? | Hold the poster | 12 |",
		"spreadsheet": "Scene\tCharacters\tSpeaker\tDialogue\tAction\tDuration\nBackstage\tElla\tElla\tWhy the hell is Chloe's name on my track?\tHold the poster\t12",
	} {
		t.Run(name, func(t *testing.T) {
			shots, ok := ParseStoryboardSource(source)
			if !ok || len(shots) != 1 {
				t.Fatalf("expected one parsed shot, got %d valid=%v", len(shots), ok)
			}
			if shots[0].Dialogue != line || shots[0].Speaker != "Ella" || shots[0].DurationSeconds != 12 {
				t.Fatalf("import changed approved dialogue or timing: %+v", shots[0])
			}
			if missing := MissingDialogue(SourceDialogueLines(source, SourceStoryboard), []string{shots[0].Dialogue}); len(missing) != 0 {
				t.Fatal("unchanged imported dialogue rejected")
			}
		})
	}
}

func TestFG156DialogueCheckAcceptsSplitAndRejectsParaphrase(t *testing.T) {
	original := []string{"It's fine. I'll handle the follow-up."}
	if len(MissingDialogue(original, []string{"It's fine.", "I'll handle the follow-up."})) != 0 {
		t.Fatal("split dialogue incorrectly treated as missing")
	}
	if len(MissingDialogue(original, []string{"No worries. I'll take care of it."})) != 1 {
		t.Fatal("rewritten dialogue silently accepted")
	}
	if _, ok := ParseStoryboardSource("An ordinary story without a storyboard table"); ok {
		t.Fatal("ordinary prose incorrectly treated as direct storyboard")
	}
}
