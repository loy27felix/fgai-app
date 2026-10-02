package app

import (
 "encoding/json"
 "strings"
 "infinite-canvas/backend/internal/model"
)

// Async WeToken receipts use the task ID in the create body, not the proxy's
// request header. Preserve both without changing the ID used for polling.
func enrichFGAsyncFeeReferences(call *model.ApiCallLog, body []byte) {
 if !call.Billable || call.RequestKind != "create" || (call.Capability != "image" && call.Capability != "video") { return }
 var response struct {
  ID string `json:"id"`
  TaskID string `json:"task_id"`
  Output struct { TaskID string `json:"task_id"` } `json:"output"`
 }
 if json.Unmarshal(body,&response)!=nil { return }
 var refs []string
 _ = json.Unmarshal([]byte(call.FGFeeReferencesJSON),&refs)
 candidates:=[]string{response.TaskID,response.Output.TaskID}
 if strings.Contains(strings.ToLower(call.Model),"seedance") { candidates=append(candidates,response.ID) }
 for _, raw:=range candidates {
  value:=strings.TrimSpace(raw)
  if value=="" || len(value)>160 {continue}
  found:=false;for _, existing:=range refs {if existing==value {found=true;break}}
  if !found {refs=append(refs,value)}
 }
 if encoded,err:=json.Marshal(refs);err==nil {call.FGFeeReferencesJSON=string(encoded)}
}
