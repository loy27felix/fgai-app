import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const root = await mkdtemp(join(tmpdir(), "meilin-studio-"));
process.env.MEILIN_SKILLS_DIR = root;
const { runContext } = await import("./fg-context.mjs");
const {
  initializeStudio,
  legacyStudio,
  addArtifact,
  approveArtifact,
  queueTurn,
  executeRun,
  studioAction,
  markStudioRunFailed,
  prepareMedia,
} = await import("./studio.mjs");
const { phaseSources, loadPhase } = await import("./studio-skills.mjs");
const { MODELS } = await import("./models.mjs");
const actor = { id: randomUUID() };
const ctx = (fn) =>
  runContext({ actor, models: MODELS, operationId: randomUUID() }, fn);
const project = () =>
  initializeStudio(
    {
      id: randomUUID(),
      titleZh: "",
      settings: {
        textModel: "gpt-6.1-sol",
        imageModel: "gpt-image-2.5-sunburst",
        imageParams: {},
        videoModel: "dreamina-seedance-2-5-filter-off",
        videoParams: { preview: "480p" },
        aspect: "9:16",
      },
      assets: { items: [] },
      episodes: [],
      uploads: [],
      messages: [],
      production: [],
    },
    { chain: "prism" },
  );
for (const [id, file] of ["concept", "script", "audit"].flatMap(phase => phaseSources("prism", phase))) {
  const path = join(root, id, file);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "完整测试方法原文，不截断。");
}
after(() => rm(root, { recursive: true, force: true }));

test("conversation edits an existing artifact, preserves earlier version and focuses the visible result", () =>
  ctx(async () => {
    const d = project(),
      original = addArtifact(d, {
        kind: "script",
        title: "神殿祭品",
        content: "原稿台词保持。",
        data: {},
      });
    const other = addArtifact(d, {
        kind: "concept",
        title: "故事",
        content: "强钩子方案。",
        data: {},
      }),
      untouched = JSON.stringify(other);
    queueTurn(d, "把男主反击写得更主动");
    const run = d.studio.runs[0];
    await executeRun(d, run, async (req) =>
      req.system.startsWith("美林任务路由")
        ? JSON.stringify({ phase: "concept" })
        : JSON.stringify({
            reply: "已修改男主行动，展现区已更新。",
            artifacts: [
              {
                id: original.id,
                kind: "script",
                title: "神殿祭品",
                content: "原稿台词保持。男主主动拉断锁链。",
                data: {},
              },
            ],
          }),
    );
    assert.equal(original.versions.length, 1);
    const saved = d.studio.artifacts.find((a) => a.id === original.id);
    assert.equal(saved.versions.length, 2);
    assert.match(saved.versions[1].content, /主动/);
    assert.equal(saved.versions[0].content, "原稿台词保持。");
    assert.equal(d.studio.focus, original.id);
    assert.equal(
      JSON.stringify(d.studio.artifacts.find((a) => a.id === other.id)),
      untouched,
    );
    assert.equal(d.studio.runs[0].status, "succeeded");
    assert.equal(d.production.length, 0);
  }));
test("an unapproved revision does not invalidate old approval; approving it invalidates only downstream dependencies", () =>
  ctx(() => {
    const d = project(),
      story = addArtifact(d, { kind: "concept", content: "故事A", data: {} });
    approveArtifact(d, story.id, story.current);
    const script = addArtifact(d, {
      kind: "script",
      content: "已确认剧本A",
      data: {},
    });
    approveArtifact(d, script.id, script.current);
    const prior = story.approved;
    addArtifact(d, {
      id: story.id,
      kind: "concept",
      content: "故事B",
      data: {},
    });
    assert.equal(story.approved, prior);
    assert.equal(script.stale, false);
    approveArtifact(d, story.id, story.current);
    assert.equal(script.stale, true);
    assert.equal(story.stale, false);
    assert.equal(story.versions.at(-1).dependencies.length, 0);
  }));
test("audit mode cannot mutate scripts or submit image and video tasks", () =>
  ctx(async () => {
    const d = project();
    d.studio.mode = "audit";
    d.studio.stage = "audit";
    const source = addArtifact(d, {
      kind: "script",
      content: "原始剧本不可自动改写。",
      data: {},
    });
    await assert.rejects(
      executeRun(
        d,
        {
          id: "audit-test",
          base: [],
          phase: "audit",
          receipts: [],
          request: {},
        },
        async () =>
          JSON.stringify({
            reply: "错误改写",
            artifacts: [
              { id: source.id, kind: "script", content: "改写后", data: {} },
            ],
          }),
      ),
      /体检任务/,
    );
    assert.throws(
      () =>
        prepareMedia(d, { artifactId: source.id, itemKey: "x", kind: "video" }),
      /不生成媒体/,
    );
    assert.equal(source.versions.length, 1);
  }));

test("selected uploaded script is audit source, never a request to write a script", () =>
  ctx(async () => {
    const d = project();
    d.studio.mode = "audit";
    d.studio.stage = "audit";
    const source = addArtifact(d, { kind: "script", title: "原剧本.docx", content: "保留原稿对白和情节。", data: {} });
    queueTurn(d, "帮我看一下这个剧本逻辑，并对剧本提出修改意见", { targetId: source.id });
    const run = d.studio.runs[0];
    assert.equal(run.phase, "audit");
    assert.equal(run.request.sourceAction, "studio.audit");
    const payload = JSON.parse(run.request.messages[0].content);
    assert.equal(payload.targetArtifact, null);
    assert.equal(payload.sourceArtifact, source.id);
    const requests = [];
    await executeRun(d, run, async req => {
      requests.push(req);
      assert.equal(req.sourceAction, "studio.audit");
      assert.equal(JSON.parse(req.messages[0].content).taskStage, "audit");
      return JSON.stringify({ reply: "已完成剧本体检，原稿保留。", artifacts: [{ kind: "audit", title: "剧本压力测试", content: "原文证据：保留原稿对白和情节。最弱环与修改建议。", data: {} }] });
    });
    assert.equal(requests.length, 1);
    assert.equal(d.studio.artifacts.find(a => a.id === source.id).versions.length, 1);
    assert.equal(d.studio.artifacts.find(a => a.id === source.id).versions[0].content, "保留原稿对白和情节。");
    assert.equal(d.studio.artifacts.at(-1).kind, "audit");
    assert.equal(d.production.length, 0);
  }));

test("retry repairs historical audit runs wrongly queued as script without replaying the bad route", () =>
  ctx(async () => {
    const d = project();
    d.studio.mode = "audit";
    d.studio.stage = "audit";
    const source = addArtifact(d, { kind: "script", content: "原稿不变。", data: {} });
    queueTurn(d, "检查剧本", { targetId: source.id });
    const run = d.studio.runs[0];
    run.phase = "script";
    run.request.sourceAction = "studio.script";
    run.request.messages[0].content = JSON.stringify({ ...JSON.parse(run.request.messages[0].content), taskStage: "script", targetArtifact: source.id });
    run.status = "failed";
    run.error = "体检任务只允许压力测试";
    studioAction(d, "retry", { id: run.id });
    await executeRun(d, run, async req => {
      assert.equal(req.sourceAction, "studio.audit");
      assert.match(req.system, /06_剧本压力测试/);
      assert.doesNotMatch(req.system, /05_剧本深度融合/);
      const payload = JSON.parse(req.messages[0].content);
      assert.equal(payload.targetArtifact, null);
      assert.equal(payload.sourceArtifact, source.id);
      return JSON.stringify({ reply: "体检报告已更新。", artifacts: [{ kind: "audit", content: "逻辑检查建议。", data: {} }] });
    });
    assert.equal(d.studio.runs[0].phase, "audit");
    assert.equal(d.studio.runs[0].status, "succeeded");
    assert.equal(d.studio.artifacts.find(a => a.id === source.id).versions.length, 1);
  }));

test("audit follow-up revises the selected report and keeps every uploaded source unchanged", () =>
  ctx(async () => {
    const d = project();
    d.studio.mode = "audit";
    d.studio.stage = "audit";
    const source = addArtifact(d, { kind: "script", content: "第一场原稿。", data: {} });
    const report = addArtifact(d, { kind: "audit", title: "体检报告", content: "原报告。", data: {} });
    queueTurn(d, "再详细解释第二个逻辑问题", { targetId: report.id });
    await executeRun(d, d.studio.runs[0], async req => {
      assert.equal(JSON.parse(req.messages[0].content).targetArtifact, report.id);
      return JSON.stringify({ reply: "已补充报告。", artifacts: [{ id: report.id, kind: "audit", title: "体检报告", content: "原报告。第二个问题的原文证据与建议。", data: {} }] });
    });
    assert.equal(d.studio.artifacts.length, 2);
    assert.equal(d.studio.artifacts.find(a => a.id === report.id).versions.length, 2);
    assert.equal(d.studio.artifacts.find(a => a.id === source.id).versions.length, 1);
  }));
test("generation rejects an unapproved or stale prompt before creating paid work", () =>
  ctx(() => {
    const d = project(),
      a = addArtifact(d, {
        kind: "prompts",
        content: "视频计划",
        data: {
          shots: [
            {
              key: "s1",
              title: "祭品",
              seconds: 20,
              prompt: "不完整稿",
              referenceIds: [],
            },
          ],
        },
      });
    assert.throws(
      () => prepareMedia(d, { artifactId: a.id, itemKey: "s1", kind: "video" }),
      /先确认/,
    );
    approveArtifact(d, a.id, a.current);
    assert.throws(
      () => prepareMedia(d, { artifactId: a.id, itemKey: "s1", kind: "video" }),
      /缺少/,
    );
    assert.equal(d.production.length, 0);
    assert.equal(d._pending, undefined);
  }));
test("locked duration and foreign references are rejected without partial artifact writes", () =>
  ctx(() => {
    const d = project();
    d.studio.locks.seconds = 20;
    assert.throws(
      () =>
        addArtifact(d, {
          kind: "storyboard",
          content: "分镜",
          data: {
            shots: [
              { key: "s1", title: "镜头1", seconds: 15, referenceIds: [] },
            ],
          },
        }),
      /用户锁定的20秒/,
    );
    assert.throws(
      () =>
        addArtifact(d, {
          kind: "storyboard",
          content: "分镜",
          data: {
            shots: [
              {
                key: "s1",
                title: "镜头1",
                seconds: 20,
                referenceIds: ["foreign"],
              },
            ],
          },
        }),
      /不存在的资产/,
    );
    assert.equal(d.studio.artifacts.length, 0);
  }));
test("one malformed edit in an agent result cannot commit preceding edits", () =>
  ctx(async () => {
    const d = project(),
      a = addArtifact(d, { kind: "concept", content: "保留原版", data: {} });
    queueTurn(d, "修改故事方案");
    await assert.rejects(
      executeRun(d, d.studio.runs[0], async (req) =>
        req.system.startsWith("美林任务路由")
          ? JSON.stringify({ phase: "concept" })
          : JSON.stringify({
              reply: "错误",
              artifacts: [
                { id: a.id, kind: "concept", content: "不应提交", data: {} },
                { kind: "concept", content: "", data: {} },
              ],
            }),
      ),
      /正文为空/,
    );
    assert.equal(d.studio.artifacts.length, 1);
    assert.equal(a.versions.length, 1);
    assert.equal(a.versions[0].content, "保留原版");
  }));
test("asset prompt revisions keep a single bound identity and all real image versions", () =>
  ctx(() => {
    const d = project(),
      a = addArtifact(d, {
        kind: "assets",
        content: "角色A",
        data: {
          assets: [
            {
              key: "hero",
              kind: "character",
              name: "男主",
              prompt: "黑衣青年三视图",
            },
          ],
        },
      });
    approveArtifact(d, a.id, a.current);
    const bound = d.assets.items[0];
    bound.versions.push({ id: "real", url: "/files/real.png" });
    bound.current = "real";
    addArtifact(d, {
      id: a.id,
      kind: "assets",
      content: "角色A精修",
      data: {
        assets: [
          {
            key: "hero",
            kind: "character",
            name: "男主",
            prompt: "同一黑衣青年，保留面孔",
          },
        ],
      },
    });
    approveArtifact(d, a.id, a.current);
    assert.equal(d.assets.items.length, 1);
    assert.equal(d.assets.items[0].id, bound.id);
    assert.equal(d.assets.items[0].current, "real");
    assert.equal(d.assets.items[0].versions.length, 1);
  }));
test("full source reads have receipts and an incomplete installed method fails explicitly", () =>
  ctx(async () => {
    const loaded = loadPhase("prism", "concept");
    assert.equal(loaded.receipts.length, 3);
    assert.match(loaded.text, /完整测试方法原文/);
    assert.equal(loaded.receipts[0].sha256.length, 64);
    assert.throws(() => loadPhase("prism", "characters"), /完整技能包缺少/);
  }));
test("manual prompt edits retain sibling shots and stable shot keys", () =>
  ctx(() => {
    const d = project(),
      a = addArtifact(d, {
        kind: "prompts",
        content: "逐镜稿",
        data: {
          shots: [
            {
              key: "1",
              title: "A",
              seconds: 10,
              prompt: "原稿1",
              referenceIds: [],
            },
            {
              key: "2",
              title: "B",
              seconds: 10,
              prompt: "原稿2",
              referenceIds: [],
            },
          ],
        },
      });
    studioAction(d, "edit", {
      id: a.id,
      version: a.current,
      shotKey: "1",
      content: "第一镜的新稿",
    });
    assert.equal(a.versions.at(-1).data.shots[0].prompt, "第一镜的新稿");
    assert.equal(a.versions.at(-1).data.shots[1].prompt, "原稿2");
    assert.equal(a.versions[0].data.shots[0].prompt, "原稿1");
  }));
test("legacy reads and first write resolve stable artifacts without creating duplicate episodes or losing takes", () =>
  ctx(() => {
    const original = project();
    delete original.studio;
    original.episodes = [
      {
        n: 1,
        id: "episode-1",
        title: "旧项目",
        scripts: { upload: "原稿" },
        chosen: "upload",
        segments: [
          {
            id: "shot-old",
            n: 1,
            title: "镜头1",
            seconds: 20,
            prompt: "历史提示词",
            takes: [{ url: "/real/video.mp4" }],
          },
        ],
        jobs: [],
      },
    ];
    const read = structuredClone(original),
      write = structuredClone(original);
    legacyStudio(read);
    legacyStudio(write);
    assert.deepEqual(
      read.studio.artifacts.map((a) => a.id),
      write.studio.artifacts.map((a) => a.id),
    );
    const a = write.studio.artifacts.find((a) => a.kind === "prompts");
    approveArtifact(write, a.id, a.current);
    assert.equal(write.episodes.length, 1);
    assert.equal(write.episodes[0].segments[0].id, "shot-old");
    assert.equal(write.episodes[0].segments[0].takes[0].url, "/real/video.mp4");
  }));

test('an agent cannot shorten a locked duration while asked only to accelerate action',()=>ctx(async()=>{
 const d=project();d.studio.locks.seconds=20;queueTurn(d,'把动作节奏加快，保持20秒');
 await assert.rejects(executeRun(d,d.studio.runs[0],async request=>request.system.startsWith('美林任务路由')?JSON.stringify({phase:'concept'}):JSON.stringify({reply:'错误缩短',locks:{seconds:15},artifacts:[]})),/不能.*自行改为15秒/);
 assert.equal(d.studio.locks.seconds,20);
}));

test('a user-selected descriptive visual style survives the director result',()=>ctx(async()=>{
 const d=project();d.studio.locks={track:'海外剧',seconds:90};
 queueTurn(d,'我的选择：真人实拍质感，真实演员般的皮肤、服装与神话特效');
 await executeRun(d,d.studio.runs[0],async request=>request.system.startsWith('美林任务路由')?JSON.stringify({phase:'concept'}):JSON.stringify({reply:'已保留视觉方向，请继续确认交付与衔接。',locks:{style:'真人实拍质感'},questions:[{id:'delivery',question:'交付方式？',options:['Markdown文稿','两者都要']}],artifacts:[]}));
 assert.equal(d.studio.locks.style,'真人实拍质感');
 assert.equal(d.studio.locks.seconds,90);
 assert.equal(d.studio.locks.track,'海外剧');
 assert.equal(d.studio.questions[0].id,'delivery');
 assert.equal(d.studio.runs[0].status,'succeeded');
 assert.equal(d.production.length,0);
}));

test('explained choices normalize only recognized settings and preserve other locks',()=>ctx(()=>{
 const d=project();d.studio.locks={seconds:90,track:'海外剧'};
 studioAction(d,'locks',{style:'真人实拍质感：保留皮肤纹理与神话特效',delivery:'平台内完整Markdown文稿：中文剧本、双语台词及投喂制作稿（推荐）',splice:'换机位硬切：通过不同景别和视角衔接（推荐）'});
 assert.equal(d.studio.locks.delivery,'Markdown文稿');
 assert.equal(d.studio.locks.splice,'换机位硬切');
 assert.equal(d.studio.locks.seconds,90);
 assert.match(d.studio.locks.style,/皮肤纹理/);
 assert.throws(()=>studioAction(d,'locks',{delivery:'自动发布并编译HTML'}),/制作设置无效/);
 assert.throws(()=>studioAction(d,'locks',{style:''}),/视觉方向/);
}));

test('a failed turn restores pending questions, while successful turns remove the snapshot',()=>ctx(async()=>{
 const d=project();d.studio.questions=[{id:'style',question:'选择画风',options:['写实','动画']}];
 queueTurn(d,'选择写实');const run=d.studio.runs[0];
 assert.equal(d.studio.questions.length,0);
 markStudioRunFailed(d,run,Error('临时请求失败'));
 assert.equal(d.studio.questions[0].id,'style');
 assert.equal(run.status,'failed');
}));
