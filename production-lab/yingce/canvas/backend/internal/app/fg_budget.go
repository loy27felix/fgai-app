package app

import (
 "bytes"
 "context"
 "encoding/json"
 "errors"
 "io"
 "net/http"
 "os"
 "time"
)

type fgBudgetKey struct{}
func fgBudgetReservationID(ctx context.Context)string{value,_:=ctx.Value(fgBudgetKey{}).(string);return value}

// Runs immediately before billable calls, including native tasks and Agent
// proxies. The internal secret is never sent to a model provider.
func (s *Service) ReserveFGBudget(ctx context.Context,userID,taskID,modelKey,capability string,body []byte)(string,error){
 if os.Getenv("CANVAS_FG_TEAM_WORKSPACE")!="true" {return "",nil}
 secret:=os.Getenv("CANVAS_FG_BUDGET_SECRET")
 if secret=="" {return "",errors.New("费用限额服务尚未配置，已暂停提交")}
 var payload any
 if json.Unmarshal(body,&payload)!=nil {payload=map[string]any{"unparsed":true}}
 data,_:=json.Marshal(map[string]any{"userId":userID,"taskId":taskID,"model":modelKey,"capability":capability,"payload":payload})
 req,err:=http.NewRequestWithContext(ctx,http.MethodPost,"http://gateway:3010/internal/fg/budget-admission",bytes.NewReader(data));if err!=nil{return "",err}
 req.Header.Set("Content-Type","application/json");req.Header.Set("X-FG-Budget-Secret",secret)
 client:=&http.Client{Timeout:20*time.Second,CheckRedirect:func(*http.Request,[]*http.Request)error{return http.ErrUseLastResponse}}
 response,err:=client.Do(req);if err!=nil{return "",errors.New("费用限额检查暂不可用，请稍后重试")};defer response.Body.Close()
 raw,err:=io.ReadAll(io.LimitReader(response.Body,4096));if err!=nil{return "",err}
 var result struct{ID string `json:"id"`;Error string `json:"error"`}
 if json.Unmarshal(raw,&result)!=nil{return "",errors.New("费用限额响应无效，已暂停提交")}
 if response.StatusCode!=200||result.ID=="" {if result.Error!=""{return "",errors.New(result.Error)};return "",errors.New("费用限额检查失败，已暂停提交")}
 return result.ID,nil
}
