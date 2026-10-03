package app

import (
 "context"
 "testing"
)

func TestFGBudgetAdmissionFailsClosedWithoutInternalSecret(t *testing.T) {
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "true")
 t.Setenv("CANVAS_FG_BUDGET_SECRET", "")
 s := &Service{}
 id, err := s.ReserveFGBudget(context.Background(), "actor", "task", "model", "text", []byte(`{}`))
 if err == nil || id != "" { t.Fatal("FG must not send provider requests without its budget gate") }
}

func TestFGBudgetAdmissionDoesNotAffectStandaloneUpstream(t *testing.T) {
 t.Setenv("CANVAS_FG_TEAM_WORKSPACE", "false")
 s := &Service{}
 id, err := s.ReserveFGBudget(context.Background(), "actor", "task", "model", "text", nil)
 if err != nil || id != "" { t.Fatal("standalone deployments should bypass the FG-only gate") }
}
