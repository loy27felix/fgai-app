package handler

import (
    "testing"
    "yingce/backend/internal/model"
)
func TestFGSystemProxyRetainsFeeHeader(t *testing.T){
    entry:=apiCallLog(&model.User{ID:"fg-user"},&model.ModelChannel{ID:"fg-channel"},"","text",model.ChannelInterfaceChatCompletion,"POST","/v1/chat/completions","https://wetoken.ai/v1/chat/completions",[]byte(`{"model":"gpt-5.6-sol-t1a"}`),"application/json",model.ApiCallStatusSucceeded,200,0,"",2," fee-reference-1 ")
    if entry.FGFeeReferenceID!="fee-reference-1"||entry.ProviderRequestID!=""||entry.Model!="gpt-5.6-sol-t1a"||!entry.Billable{t.Fatal(entry)}
}
