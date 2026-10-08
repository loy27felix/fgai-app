package app

import "testing"

func TestFGSeedreamLiteDeclared4KPreservesProviderPixels(t *testing.T) {
 profile := DefaultImageCapabilityConfig("volcengine-ark-image", "seedream-5-0-lite-260128")
 profile.Size.Parameter = "size"
 profile.Size.Values = []string{"4096x4096"}
 profile.Size.Default = "4096x4096"
 profile.Size.AllowCustom = false
 profile.Size.Presets = []ImageSizePreset{{Size:"4096x4096",Tier:"4k",Ratio:"1:1",Width:4096,Height:4096}}
 if err := validateImageCapabilityConfig(profile); err != nil { t.Fatal(err) }
 body,err := volcengineArkImageBody(canvasGenerationInput{Config:providerConfig{Model:"seedream-5-0-lite-260128",Size:"4096x4096"},ImageCapability:profile})
 if err != nil { t.Fatal(err) }
 if body["size"]!="4096x4096" { t.Fatalf("declared provider pixels were silently resized: %v",body["size"]) }
 profile.Size.Presets[0].Width=8192
 if validateImageCapabilityConfig(profile)==nil { t.Fatal("inconsistent preset should be rejected before billing") }
}
