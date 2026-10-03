package app

import "testing"

func TestFGTextOutputCeiling(t *testing.T) {
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
	for _, field := range []string{"max_tokens", "max_output_tokens"} {
		body := map[string]interface{}{}
		applyTextOutputLimit(body, 0, field)
		if body[field] != 16384 { t.Fatalf("missing FG provider ceiling for %s", field) }
		applyTextOutputLimit(body, 512, field)
		if body[field] != 512 { t.Fatal("explicit ceiling changed") }
	}
	t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "false")
	body := map[string]interface{}{}
	applyTextOutputLimit(body, 0, "max_tokens")
	if len(body) != 0 { t.Fatal("standalone provider behavior changed") }
}
