package app

import "testing"

func TestFGReferenceLimitsCheckAggregateAndStrictImageBytes(t *testing.T) {
 r:=VideoReferenceConfig{MaxImageBytes:30*1024*1024,ImageBytesExclusive:true,MinVideoDuration:2,MaxTotalVideoDuration:30,MaxTotalAudioDuration:30,MinImageSide:300,MaxImageSide:6000,MinImageRatio:.4,MaxImageRatio:2.5,MinVideoPixels:407696,MaxVideoPixels:8295044}
 in:=canvasGenerationInput{ReferenceVideos:[]providerMedia{{DurationMs:15000,Width:1280,Height:720},{DurationMs:15000,Width:1280,Height:720}}}
 if err:=validateFGReferenceLimits(r,in);err!=nil{t.Fatal(err)}
 in.ReferenceVideos[1].DurationMs=15001
 if validateFGReferenceLimits(r,in)==nil{t.Fatal("aggregate duration must be rejected")}
 in.ReferenceVideos=nil;in.ReferenceImages=[]providerMedia{{Bytes:30*1024*1024}}
 if validateFGReferenceLimits(r,in)==nil{t.Fatal("Seedance images must be strictly below 30MB")}
 in.ReferenceImages[0].Bytes--
 if err:=validateFGReferenceLimits(r,in);err!=nil{t.Fatal(err)}
 in.ReferenceImages[0].Width=299;in.ReferenceImages[0].Height=600
 if validateFGReferenceLimits(r,in)==nil{t.Fatal("undersized image must be rejected")}
}

func TestFGSeedreamCustomPixelLimits(t *testing.T) {
 c:=&ImageSizeConstraints{MinPixels:3686400,MaxPixels:16777216,MaxRatio:16}
 for _,size:=range []string{"3750x1250","4096x4096","6240x2656"}{if err:=validateFGImageDimensions(size,c);err!=nil{t.Fatal(size,err)}}
 for _,size:=range []string{"1500x1500","8192x8192","-1x4096","999999999999x1"}{if validateFGImageDimensions(size,c)==nil{t.Fatal("invalid size accepted",size)}}
}
