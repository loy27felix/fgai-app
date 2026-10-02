package app

import (
 "fmt"
 "strconv"
 "strings"
)

// Apply documented limits only when metadata is known; signed URLs still reach
// the provider for codec / frame-rate validation. No silent resize or truncation.
func validateFGReferenceLimits(r VideoReferenceConfig, input canvasGenerationInput) error {
 var videoMs, audioMs int64
 checkShape := func(w,h int,isVideo bool) error {
  if w<=0 || h<=0 { return nil }
  ratio:=float64(w)/float64(h)
  if (r.MinImageSide>0 && (w<r.MinImageSide||h<r.MinImageSide)) || (r.MaxImageSide>0&&(w>r.MaxImageSide||h>r.MaxImageSide)) || (r.MinImageRatio>0&&ratio<r.MinImageRatio) || (r.MaxImageRatio>0&&ratio>r.MaxImageRatio) { return BadAuthRequest("参考素材宽高或宽高比超出当前模型限制") }
  pixels:=int64(w)*int64(h)
  if isVideo && ((r.MinVideoPixels>0&&pixels<int64(r.MinVideoPixels)) || (r.MaxVideoPixels>0&&pixels>int64(r.MaxVideoPixels))) { return BadAuthRequest("参考视频像素总量超出当前模型限制") }
  return nil
 }
 checkFormat:=func(kind string,formats []string) error {
  kind=strings.ToLower(strings.TrimSpace(strings.Split(kind,";")[0]))
  if strings.Contains(kind,"/") { kind=strings.SplitN(kind,"/",2)[1] }
  switch kind {case "quicktime":kind="mov";case "mpeg":kind="mp3";case "x-wav":kind="wav";case "x-ms-bmp":kind="bmp"}
  if kind=="" || kind=="octet-stream" || len(formats)==0 { return nil }
  if !containsCapabilityString(formats,kind) {return BadAuthRequest("参考素材格式不在当前模型支持范围内")};return nil
 }
 for _,m:=range input.ReferenceImages {
  if r.ImageBytesExclusive&&r.MaxImageBytes>0&&m.Bytes>=r.MaxImageBytes { return BadAuthRequest("参考图片必须小于当前模型单图大小上限") }
  if err:=checkShape(m.Width,m.Height,false);err!=nil{return err};if err:=checkFormat(m.Type,r.ImageFormats);err!=nil{return err}
 }
 for _,m:=range input.ReferenceVideos {
  videoMs+=m.DurationMs
  if r.MinVideoDuration>0&&m.DurationMs>0&&m.DurationMs<int64(r.MinVideoDuration)*1000 {return BadAuthRequest("参考视频时长低于当前模型最短限制")}
  if err:=checkShape(m.Width,m.Height,true);err!=nil{return err};if err:=checkFormat(m.Type,r.VideoFormats);err!=nil{return err}
 }
 for _,m:=range input.ReferenceAudios {
  audioMs+=m.DurationMs
  if r.MinAudioDuration>0&&m.DurationMs>0&&m.DurationMs<int64(r.MinAudioDuration)*1000 {return BadAuthRequest("参考音频时长低于当前模型最短限制")}
  if err:=checkFormat(m.Type,r.AudioFormats);err!=nil{return err}
 }
 if r.MaxTotalVideoDuration>0&&videoMs>int64(r.MaxTotalVideoDuration)*1000 {return BadAuthRequest(fmt.Sprintf("参考视频累计时长最多 %d 秒",r.MaxTotalVideoDuration))}
 if r.MaxTotalAudioDuration>0&&audioMs>int64(r.MaxTotalAudioDuration)*1000 {return BadAuthRequest(fmt.Sprintf("参考音频累计时长最多 %d 秒",r.MaxTotalAudioDuration))}
 return nil
}

func validateFGImageDimensions(size string,c *ImageSizeConstraints) error {
 parts:=strings.Split(strings.ToLower(strings.ReplaceAll(size,"×","x")),"x")
 if len(parts)!=2 {return BadAuthRequest("自定义图片尺寸须填写宽x高")}
 w,e1:=strconv.Atoi(parts[0]);h,e2:=strconv.Atoi(parts[1])
 if e1!=nil||e2!=nil||w<=0||h<=0||w>16777216||h>16777216{return BadAuthRequest("图片宽高必须是有效正整数")}
 pixels:=int64(w)*int64(h);ratio:=float64(w)/float64(h)
 if pixels<int64(c.MinPixels)||pixels>int64(c.MaxPixels)||ratio>c.MaxRatio||ratio<1/c.MaxRatio{return BadAuthRequest("自定义图片像素总量或宽高比超出当前模型官方范围")}
 return nil
}
