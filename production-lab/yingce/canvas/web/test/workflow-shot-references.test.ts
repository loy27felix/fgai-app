import { describe, expect, test } from "bun:test";

import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import type { ProjectAsset, ProjectDetail } from "@/services/api/projects";
import { assertShotCharacterCoverage, buildShotAssetReferenceContext, ensureShotAssetMentionPrompt, inferShotVisualAssets, projectAssetReferenceImage, resolveShotAssetMentionPrompt } from "@/pages/projects/detail/workflow-shot-references";
import { assertVideoCapability } from "@/services/api/video-validation";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { replaceShotCostumeTimeline, shotCostumeTimelines, validateShotCostumeTimeline, type ShotCostumeTimeline } from "@/pages/projects/detail/shot-costume-timeline";
import { prepareShotVideoExecution } from "@/pages/projects/detail/shot-video-execution";

describe("workflow shot asset references", () => {
    function explicitWardrobeFixture() {
        const source=detail(), original=source.assets.find(asset=>asset.character)!;
        original.title="艾拉";original.character!.definition={aliases:["Ella"]};
        const duplicate={...original,id:"duplicate-ella",primaryVersionId:"duplicate-version",character:{...original.character!,definition:{aliases:[]}}};
        const look={...original,id:"ella-look",title:"艾拉男装",primaryVersionId:"look-version",character:{...original.character!,versionId:"look-version",definition:{aliases:[]},representations:[{id:"look",resourceId:"male-look-image",mediaType:"image",role:"primary"}]}};
        source.assets.push(duplicate,look);
        source.shotReferences=source.shotReferences.filter(ref=>ref.assetVersionId!==original.primaryVersionId);
        source.shotReferences.push({id:"look-binding",shotId:"shot-1",assetVersionId:"look-version",role:"reference",status:"linked",createdAt:"2026-08-29T00:00:03Z",asset:look});
        return {source,original,look};
    }
    test("a single explicit Ella wardrobe reference resolves both Chinese and English story names despite duplicate library cards",()=>{
        const {source,look}=explicitWardrobeFixture();
        const prompt="【15秒分镜／动作时间轴】\n人物动作：艾拉摘下帽子，Ella走到窗前。\n镜头运动：跟随。\n背景：窗外下雨。\n【角色参考】\n艾拉男装：@[asset:ella-look]";
        const execution=prepareShotVideoExecution(prompt,buildShotAssetReferenceContext(source,"shot-1"),{projectAssets:source.assets});
        expect(execution.context.assetReferences.find(ref=>ref.assetId===look.id)?.aliases).toContain("艾拉");
        expect(execution.context.assetReferences.find(ref=>ref.assetId===look.id)?.aliases).toContain("Ella");
        expect(execution.prompt).toContain("艾拉男装、艾拉、Ella指同一角色");
        expect(execution.context.referenceImages.some(image=>image.storageKey==="resource:male-look-image")).toBe(true);
        expect(execution.context.assetReferences.some(ref=>ref.assetId==="asset-character" || ref.assetId==="duplicate-ella")).toBe(false);
        expect(inferShotVisualAssets(source.assets,"艾拉与Ella走到窗前",[look.id]).map(asset=>asset.id)).toEqual([look.id]);
    });
    test("a similar name alone, an unselected wardrobe, or two selected Ella looks cannot pick a face",()=>{
        const {source,look}=explicitWardrobeFixture();
        const context=buildShotAssetReferenceContext(source,"shot-1");
        expect(()=>prepareShotVideoExecution("艾拉走到窗前",context,{projectAssets:source.assets})).toThrow("多个资产");
        look.title="艾拉的妹妹";
        expect(()=>prepareShotVideoExecution("艾拉走到窗前。@[asset:ella-look]",buildShotAssetReferenceContext(source,"shot-1"),{projectAssets:source.assets})).toThrow("多个资产");
        look.title="艾拉男装";
        const second={...look,id:"second-look",title:"艾拉礼服",primaryVersionId:"second-look-version"};source.assets.push(second);
        source.shotReferences.push({id:"second-binding",shotId:"shot-1",assetVersionId:second.primaryVersionId,role:"reference",status:"linked",createdAt:"2026-08-29T00:00:04Z",asset:second});
        expect(()=>prepareShotVideoExecution("艾拉走到窗前。@[asset:ella-look] @[asset:second-look]",buildShotAssetReferenceContext(source,"shot-1"),{projectAssets:source.assets})).toThrow("多个资产");
    });
    test("an explicit outfit cannot hide another bound canonical actor, and unique canonical cards still work",()=>{
        const {source,original}=explicitWardrobeFixture();
        source.shotReferences.push({id:"canonical-binding",shotId:"shot-1",assetVersionId:original.primaryVersionId!,role:"reference",status:"linked",createdAt:"2026-08-29T00:00:04Z",asset:original});
        expect(()=>prepareShotVideoExecution("艾拉走到窗前。@[asset:ella-look]",buildShotAssetReferenceContext(source,"shot-1"),{projectAssets:source.assets})).toThrow("多个资产");
        source.shotReferences=source.shotReferences.filter(ref=>ref.assetVersionId!=="look-version");
        expect(()=>prepareShotVideoExecution("艾拉走到窗前。@[asset:asset-character]",buildShotAssetReferenceContext(source,"shot-1"),{projectAssets:source.assets})).not.toThrow();
    });
    function wardrobeFixture() {
        const source = detail(), asset = source.assets.find(a => a.character)!;
        asset.character!.representations.push({id:"night",resourceId:"night-coat",mediaType:"image",role:"costume:night",metadata:{name:"夜景外套",clothing:"深蓝风衣"}});
        asset.character!.voice = {profile:{sampleResourceId:"male-voice"}} as never;
        const ref = source.shotReferences.find(r => r.assetVersionId === asset.primaryVersionId)!;
        ref.asset = asset;
        ref.referencedVersion = {id:ref.assetVersionId,assetId:asset.id,version:1,representations:asset.character!.representations};
        const plan: ShotCostumeTimeline = {kind:"character_costume_timeline",assetId:asset.id,assetVersionId:ref.assetVersionId,segments:[{startMs:0,endMs:5000,role:"reference",resourceId:"character-cover"},{startMs:5000,endMs:15000,role:"costume:night",resourceId:"night-coat"}]};
        source.shots = [{id:"shot-1",currentRevisionId:"revision-1",durationMs:15000}] as ProjectDetail["shots"];
        source.shotRevisions = [{id:"revision-1",shotId:"shot-1",durationMs:15000,actionBeatsJson:replaceShotCostumeTimeline('[{"kind":"story-beat","text":"keep"}]',asset.id,plan)}] as ProjectDetail["shotRevisions"];
        return {source,asset,plan,ref};
    }
    test("one shot submits both outfits with timed bindings, one identity and one voice sample",()=>{
        const {source}=wardrobeFixture();
        const context=buildShotAssetReferenceContext(source,"shot-1");
        expect(context.referenceImages.map(r=>r.storageKey)).toEqual(["resource:scene-image","resource:character-cover","resource:night-coat"]);
        expect(new Set(context.referenceImages.map(r=>r.id)).size).toBe(3);
        expect(context.mentionReferences.filter(r=>r.assetId==="asset-character")).toHaveLength(1);
        expect(context.referenceAudios).toHaveLength(1);
        const execution=prepareShotVideoExecution("林默：@[asset:asset-character]在5秒处换上外套。",context,{useVoiceSamples:true});
        expect(execution.prompt).toContain("0–5秒");
        expect(execution.prompt).toContain("5–15秒");
        expect(execution.prompt).toContain("图片3");
        expect(execution.prompt).toContain("同一角色");
        expect(execution.metadata.referenceManifest).toHaveLength(3);
        expect(prepareShotVideoExecution("林默换装",context,{dialogue:"Lin: Keep the original words."}).prompt.match(/Lin: Keep the original words\./g)).toHaveLength(1);
        expect(()=>prepareShotVideoExecution("林默换装",context,{durationMs:14000})).toThrow("镜头时长已修改");
        const replay=buildShotAssetReferenceContext(JSON.parse(JSON.stringify(source)),"shot-1");
        expect(prepareShotVideoExecution("@[asset:asset-character]",replay).metadata.referenceManifest).toEqual(prepareShotVideoExecution("@[asset:asset-character]",context).metadata.referenceManifest);
        expect(source.shotRevisions[0].actionBeatsJson).toContain('"text":"keep"');
    });
    test("returning to an earlier outfit reuses its image and leaves another character's mention index correct",()=>{
        const {source,plan,asset}=wardrobeFixture();
        plan.segments[1].endMs=10000;
        plan.segments.push({startMs:10000,endMs:15000,role:"reference",resourceId:"character-cover"});
        source.shotRevisions[0].actionBeatsJson=replaceShotCostumeTimeline("[]",asset.id,plan);
        const scene=source.assets[0];source.assets.push({...scene,id:"another-scene",title:"室内",primaryVersionId:"another-version"});
        source.shotReferences.push({id:"later",shotId:"shot-1",assetVersionId:"another-version",role:"reference",status:"linked",createdAt:"2026-08-29T00:00:05Z"});
        const context=buildShotAssetReferenceContext(source,"shot-1");
        expect(context.referenceImages).toHaveLength(4);
        expect(resolveShotAssetMentionPrompt("@[asset:another-scene]",context)).toContain("图片4");
        expect(resolveShotAssetMentionPrompt("回忆",context)).toContain("0–5秒、10–15秒");
        const sceneFiltered=prepareShotVideoExecution("空间中只有林默。室内无人。",context).context;
        expect(sceneFiltered.referenceImages.filter(image=>image.storageKey==="resource:night-coat")).toHaveLength(1);
        expect(shotCostumeTimelines("legacy non-json beat text")).toEqual([]);
    });
    test("a changed outfit or duration blocks submission instead of silently falling back",()=>{
        const {source,plan,ref}=wardrobeFixture();
        expect(()=>validateShotCostumeTimeline(plan,15000,ref.assetVersionId,ref.referencedVersion!.representations)).not.toThrow();
        expect(()=>validateShotCostumeTimeline(plan,14000,ref.assetVersionId,ref.referencedVersion!.representations)).toThrow("时间无效");
        ref.referencedVersion!.representations[1].resourceId="replaced-image";
        const context=buildShotAssetReferenceContext(source,"shot-1");
        expect(()=>prepareShotVideoExecution("林默换装",context)).toThrow("参考图已变更");
    });
    test("bound preview, mention and submission use the same historical image, not the latest cover",()=>{
        const source=detail(), character=source.assets.find(a=>a.character)!;
        const reference=source.shotReferences.find(r=>r.assetVersionId===character.primaryVersionId)!;
        reference.asset=character;
        reference.referencedVersion={id:reference.assetVersionId,assetId:character.id,version:1,representations:[{id:"old",resourceId:"old-image",mediaType:"image",role:"primary"}]};
        const context=buildShotAssetReferenceContext(source,"shot-1");
        expect(projectAssetReferenceImage(character,reference)?.storageKey).toBe("resource:old-image");
        expect(context.mentionReferences.find(r=>r.assetId===character.id)?.storageKey).toBe("resource:old-image");
        expect(context.referenceImages[1].storageKey).toBe("resource:old-image");
        reference.role="costume:night";
        reference.referencedVersion.representations.push({id:"night",resourceId:"night-coat",mediaType:"image",role:"costume:night",metadata:{name:"夜景外套",clothing:"深蓝风衣"}});
        const dressed=buildShotAssetReferenceContext(source,"shot-1");
        expect(dressed.referenceImages[1].storageKey).toBe("resource:night-coat");
        expect(resolveShotAssetMentionPrompt("人物进门",dressed)).toContain("深蓝风衣");
        reference.role="costume:missing";
        expect(()=>buildShotAssetReferenceContext(source,"shot-1")).toThrow("未使用其他图片代替");
    });
    test("confirmed character aliases resolve without guessing name prefixes", () => {
        const source = detail();
        const character = source.assets.find(asset => asset.character)!;
        character.title = "卡尔文·贝内特";
        character.character!.definition = { aliases: ["卡尔", "Cal"] };
        expect(inferShotVisualAssets(source.assets, "卡尔扶住艾玛").map(asset => asset.id)).toEqual([character.id]);
        expect(inferShotVisualAssets(source.assets, "Cal crosses the bridge").map(asset => asset.id)).toEqual([character.id]);
        expect(inferShotVisualAssets(source.assets, "Calvinson crosses the bridge")).toEqual([]);
        const submitted = resolveShotAssetMentionPrompt("卡尔与 Cal 是同一个人物，扶住桥栏。", buildShotAssetReferenceContext(source, "shot-1"));
        expect(submitted).toContain("卡尔文·贝内特、卡尔、Cal指同一角色，只从图片2继承面部身份");
        expect(submitted).toContain("不混用其他角色或场景图中的脸");
        source.assets.push({ ...character, id: "another-cal", title: "另一个卡尔", character: { ...character.character!, definition: { aliases: ["Cal"] } } });
        expect(inferShotVisualAssets(source.assets, "Cal crosses the bridge")).toEqual([]);
    });

    test("generation rejects a named main character missing from the bound images", () => {
        const source = detail();
        const character = source.assets.find(asset => asset.character)!;
        character.title = "卡尔文·贝内特";
        character.character!.definition = { aliases: ["卡尔", "Cal"] };
        const bound = buildShotAssetReferenceContext(source, "shot-1");
        const missing = { ...bound, assetReferences: bound.assetReferences.filter(ref => ref.assetId !== character.id) };
        const prompt = "【20秒分镜／动作时间轴】\n人物动作：卡尔跑向断桥。\n镜头运动：跟随卡尔。\n背景：火光闪烁。";
        expect(() => assertShotCharacterCoverage(prompt, missing, source.assets)).toThrow("卡尔文·贝内特");
        expect(() => assertShotCharacterCoverage(prompt, bound, source.assets)).not.toThrow();
        expect(() => assertShotCharacterCoverage("【资产参考】\n卡尔文·贝内特：图片1\n【声音设计】\nCal：Only voice.", missing, source.assets)).not.toThrow();
    });
    test("polling order changes do not change image indices or reference labels", () => {
        const source = detail();
        const before = buildShotAssetReferenceContext(source, "shot-1");
        source.shotReferences.reverse();
        const after = buildShotAssetReferenceContext(source, "shot-1");
        expect(after.referenceImages.map(image => image.id)).toEqual(before.referenceImages.map(image => image.id));
        expect(after.assetReferences).toEqual(before.assetReferences);
        source.shotReferences.forEach(reference => { reference.createdAt = "2026-10-25T00:00:00Z"; });
        const tied = buildShotAssetReferenceContext(source, "shot-1");
        source.shotReferences.reverse();
        expect(buildShotAssetReferenceContext(source, "shot-1").referenceImages.map(image => image.id)).toEqual(tied.referenceImages.map(image => image.id));
    });
    test("removing a bound asset removes its generated mention but keeps authored story text", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = ensureShotAssetMentionPrompt("主角看向街道。", context.mentionReferences);
        const remaining = context.mentionReferences.filter(item => item.assetId !== "asset-scene");
        const cleaned = ensureShotAssetMentionPrompt(prompt, remaining);
        expect(cleaned).not.toContain("@[asset:asset-scene]");
        expect(cleaned).toContain("主角看向街道。");
        expect(cleaned).toContain("@[asset:asset-character]");
        expect(() => resolveShotAssetMentionPrompt(cleaned, { ...context, mentionReferences: remaining })).not.toThrow();
        expect(ensureShotAssetMentionPrompt(cleaned, remaining)).toBe(cleaned);
    });
    test("project reference placeholders are not mistaken for an unsupported image codec", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const profile = defaultModelCapabilityConfig().video!;
        profile.references.imageFormats = ["png", "jpeg", "webp"];
        profile.references.maxImages = 9;
        expect(() => assertVideoCapability(profile, context.referenceImages, [], [], String(profile.duration.default))).not.toThrow();
        expect(() => assertVideoCapability(profile, [{ ...context.referenceImages[0], type: "image/avif" }], [], [], String(profile.duration.default))).toThrow("参考素材格式");
    });
    test("auto matches confirmed visuals by segment names, ignoring unmentioned assets and text-only definitions", () => {
        const assets = detail().assets;
        assets.push({ ...assets[0], id: "text-prop", title: "旧信封", category: "prop", mediaType: "text", storageKey: undefined });
        expect(inferShotVisualAssets(assets, "林默走进雨夜街道，拿出旧信封").map((asset) => asset.id)).toEqual(["asset-scene", "asset-character"]);
        expect(inferShotVisualAssets(assets, "雨夜街道空景").map((asset) => asset.id)).toEqual(["asset-scene"]);
    });
    test("does not guess duplicate names or English name substrings", () => {
        const scene = detail().assets[0];
        const assets = [{ ...scene, id: "a", title: "Evan" }, { ...scene, id: "b", title: "门牌" }, { ...scene, id: "c", title: "门牌" }];
        expect(inferShotVisualAssets(assets, "Evans 拿起门牌")).toEqual([]);
        expect(inferShotVisualAssets(assets, "Evan: Hello.").map((asset) => asset.id)).toEqual(["a"]);
    });
    test("builds ordered image references for bound media and characters", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(context.mentionReferences.map((reference) => reference.label)).toEqual(["雨夜街道", "林默"]);
        expect(context.referenceImages.map((image) => image.id)).toEqual(["asset-scene", "asset-character"]);
        expect(context.referenceImages[1]?.storageKey).toBe("resource:character-cover");
    });

    test("resolves asset tokens to the submitted reference image order", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const [scene, character] = context.mentionReferences;
        const prompt = `让 ${canvasResourceMentionToken(character)} 从 ${canvasResourceMentionToken(scene)} 走近镜头`;

        expect(resolveShotAssetMentionPrompt(prompt, context)).toContain("让 图片2 从 图片1 走近镜头");
    });

    test("rejects stale mentions after an asset is unbound", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");

        expect(() => resolveShotAssetMentionPrompt("跟随 @[asset:missing]", context)).toThrow("未绑定到当前镜头");
    });

    test("adds bound assets as editable mention tokens without duplicating existing mentions", () => {
        const context = buildShotAssetReferenceContext(detail(), "shot-1");
        const prompt = ensureShotAssetMentionPrompt("让 @[asset:asset-character] 走近镜头", context.mentionReferences);

        expect(prompt).toContain("@[asset:asset-character]");
        expect(prompt.match(/@\[asset:asset-character\]/g)).toHaveLength(1);
        expect(prompt).toContain("【场景与道具参考】\n雨夜街道：@[asset:asset-scene]");
    });
});

function detail(): ProjectDetail {
    const scene = {
        id: "asset-scene",
        title: "雨夜街道",
        mediaType: "image",
        category: "environment",
        status: "confirmed",
        primaryVersionId: "version-scene",
        versionCount: 1,
        usages: [],
        position: 0,
        storageKey: "resource:scene-image",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    const character = {
        id: "asset-character",
        title: "林默",
        mediaType: "entity",
        category: "character",
        status: "confirmed",
        primaryVersionId: "version-character",
        versionCount: 1,
        usages: [],
        position: 1,
        updatedAt: "2026-08-29T00:00:00Z",
        character: {
            versionId: "version-character",
            version: 1,
            definition: {},
            representations: [{ id: "representation-1", resourceId: "character-cover", mediaType: "image", role: "primary" }],
            visualStatus: "ready",
            voiceStatus: "missing",
        },
    } satisfies ProjectAsset;
    const audio = {
        id: "asset-audio",
        title: "雨声",
        mediaType: "audio",
        category: "other",
        status: "confirmed",
        primaryVersionId: "version-audio",
        versionCount: 1,
        usages: [],
        position: 2,
        storageKey: "resource:rain-audio",
        updatedAt: "2026-08-29T00:00:00Z",
    } satisfies ProjectAsset;
    return {
        assets: [scene, character, audio],
        shotReferences: [
            { id: "reference-scene", shotId: "shot-1", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:00Z" },
            { id: "reference-character", shotId: "shot-1", assetVersionId: "version-character", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:01Z" },
            { id: "reference-audio", shotId: "shot-1", assetVersionId: "version-audio", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:02Z" },
            { id: "reference-other-shot", shotId: "shot-2", assetVersionId: "version-scene", role: "reference", status: "linked", createdAt: "2026-08-29T00:00:03Z" },
        ],
    } as ProjectDetail;
}
