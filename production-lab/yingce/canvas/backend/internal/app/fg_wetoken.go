package app

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "errors"
    "fmt"
    "net/url"
    "path"
    "regexp"
    "strings"
    "time"

    "infinite-canvas/backend/internal/protocol"
)

func isFGWeToken(base string) bool {
    u, err := url.Parse(base)
    return err == nil && u.Scheme == "https" && strings.EqualFold(u.Hostname(), "wetoken.ai")
}

var fgAssetID = regexp.MustCompile(`^asset-[A-Za-z0-9_-]+$`)

func fgAssetResponse(body []byte) (string, string, error) {
    var value map[string]any
    if json.Unmarshal(body, &value) != nil { return "", "", errors.New("WeToken 素材库响应格式无效") }
    if nested, ok := value["data"].(map[string]any); ok { value = nested }
    id := firstNonEmpty(metadataString(value, "Id"), metadataString(value, "id"))
    status := strings.ToLower(firstNonEmpty(metadataString(value, "Status"), metadataString(value, "status")))
    if id != "" && !fgAssetID.MatchString(id) { return "", "", errors.New("WeToken 素材库返回无效素材编号") }
    return id, status, nil
}

// Asset moderation is a separate transport stage. Its POST requests must not
// appear as a second video charge. Submission is attempted once; only status
// polls repeat. The caller's durable submission key scopes the upload key.
func prepareFGWeTokenAssets(ctx context.Context, config providerConfig, request *protocol.GenerationRequest, key string) error {
    if !isFGWeToken(config.BaseURL) || request.Capability != protocol.CapabilityVideo || !strings.Contains(strings.ToLower(request.Model), "seedance") { return nil }
    cfg := config; cfg.BaseURL = "https://asset.wetoken.ai"
    uploadCtx := withProviderRequestKind(ctx, "upload")
    submit := func(endpoint string, body map[string]any, idempotency string) ([]byte,error) {
        headers:=map[string]string{}
        if idempotency!="" {headers["Idempotency-Key"]=idempotency}
        return executeProtocolRequest(uploadCtx,cfg,protocol.RequestSpec{Method:"POST",Path:endpoint,OriginPath:true,ContentType:"application/json",Headers:headers,Auth:protocol.ManifestAuth{Type:"bearer",Field:"apiKey"},Body:body})
    }
    counter:=0
    prepare:=func(refs []protocol.MediaReference,kind,extension string) error {
        for i:=range refs {
            ref:=&refs[i];counter++
            if strings.HasPrefix(ref.URL,"asset://") {if !fgAssetID.MatchString(strings.TrimPrefix(ref.URL,"asset://")){return errors.New("WeToken 素材编号无效")};continue}
            parsed,err:=url.Parse(ref.URL)
            if err!=nil || parsed.Scheme!="https" || parsed.Hostname()=="" || ref.DataURL!="" {return errors.New("Seedance 参考素材需先上传到 FG 素材库，使用可访问的 HTTPS 素材链接")}
            name:=path.Base(parsed.Path)
            if path.Ext(name)=="" {name=fmt.Sprintf("fg-reference-%d%s",counter,extension)}
            body:=map[string]any{"model":request.Model,"url":ref.URL,"name":name,"AssetType":kind}
            if strings.HasSuffix(request.Model,"-filter-off") {body["Moderation"]=map[string]any{"Strategy":"Skip"}}
            digest:=sha256.Sum256([]byte(key+":"+fmt.Sprint(counter)))
            response,err:=submit("/v3/open/CreateAsset",body,"fg-asset-"+hex.EncodeToString(digest[:]))
            if err!=nil {return fmt.Errorf("WeToken 参考素材提交失败（未重复提交）：%w",err)}
            id,status,err:=fgAssetResponse(response)
            if err!=nil{return err};if !fgAssetID.MatchString(id){return errors.New("WeToken 素材库未返回有效素材编号")}
            deadline:=time.Now().Add(3*time.Minute)
            for status!="active" {
                if status=="failed"||status=="rejected"||status=="deleted" {return errors.New("WeToken 素材审核未通过，请更换参考素材")}
                if time.Now().After(deadline){return errors.New("WeToken 素材审核超时；未创建视频任务")}
                if err=sleepContext(ctx,2*time.Second);err!=nil{return err}
                response,err=submit("/v3/open/GetAsset",map[string]any{"model":request.Model,"Id":id},"")
                if err!=nil{return err};_,status,err=fgAssetResponse(response);if err!=nil{return err}
            }
            ref.URL="asset://"+id;ref.DataURL=""
        };return nil
    }
    if err:=prepare(request.Images,"Image",".png");err!=nil{return err}
    if err:=prepare(request.Videos,"Video",".mp4");err!=nil{return err}
    if err:=prepare(request.Audios,"Audio",".mp3");err!=nil{return err}
    request.Inputs=append(append(append([]protocol.MediaReference{},request.Images...),request.Videos...),request.Audios...)
    return nil
}

// Stock OpenAI image generation ignores edit inputs. FG switches references to
// the WeToken multipart edits endpoint while retaining the native parser,
// safe media fetcher, persistence and generation-task lifecycle.
func prepareFGWeTokenImageEdit(config providerConfig, request protocol.GenerationRequest, spec *protocol.RequestSpec) error {
    if !isFGWeToken(config.BaseURL)||config.InterfaceType!="openai-image"||len(request.Images)==0{return nil}
    spec.Path="/v1/images/edits";spec.OriginPath=true;spec.ContentType="multipart/form-data"
    body,ok:=spec.Body.(map[string]any);if !ok{return errors.New("FG 图片编辑请求格式无效")}
    delete(body,"image");spec.Files=nil
    for i,ref:=range request.Images {
        field:="image[]";if ref.Role=="mask"{field="mask"}
        spec.Files=append(spec.Files,protocol.RequestFilePart{Name:field,Filename:fmt.Sprintf("fg-image-%d.png",i),MIMEType:ref.MIMEType,Reference:ref})
    }
    return nil
}
