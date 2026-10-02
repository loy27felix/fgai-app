package app

import (
 "encoding/json"
 "testing"
 "infinite-canvas/backend/internal/model"
)

func TestFGWeTokenZeroPlaceholdersDoNotHideActualTextUsage(t *testing.T) {
 log:= &model.ApiCallLog{Capability:"text",Path:"/v1/chat/completions"}
 (&Service{}).EnrichAPICallLog(log,[]byte(`{"usage":{"input_tokens":0,"output_tokens":0,"prompt_tokens":60,"completion_tokens":110,"total_tokens":170}}`))
 if !log.UsageAvailable || log.InputTokens!=60 || log.OutputTokens!=110 { t.Fatalf("lost actual usage: %#v",log) }
 (&Service{}).EnrichAPICallLog(log,[]byte(`{"usage":{"input_tokens":60,"output_tokens":110,"prompt_tokens":60,"completion_tokens":110,"total_tokens":170}}`))
 if log.InputTokens!=60 || log.OutputTokens!=110 {t.Fatal("duplicate usage names were added twice")}
}

func TestFGAsyncReceiptPreservesRequestAndTaskIDs(t *testing.T) {
 log:= &model.ApiCallLog{Billable:true,RequestKind:"create",Capability:"image",Model:"wan2.7-image-pro",ProviderRequestID:"proxy-request",FGFeeReferencesJSON:`["proxy-request"]`}
 enrichFGAsyncFeeReferences(log,[]byte(`{"request_id":"proxy-request","output":{"task_id":"actual-task"}}`))
 var refs []string;_ = json.Unmarshal([]byte(log.FGFeeReferencesJSON),&refs)
 if len(refs)!=2 || refs[1]!="actual-task" || log.ProviderRequestID!="proxy-request" {t.Fatalf("wrong receipt references: %#v",log)}
 log.Billable=false;log.FGFeeReferencesJSON=`[]`
 enrichFGAsyncFeeReferences(log,[]byte(`{"output":{"task_id":"actual-task"}}`))
 if log.FGFeeReferencesJSON!=`[]` {t.Fatal("polling must not become billable")}
}
