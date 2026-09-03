import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { assertCreatorImageReferenceFiles, assertCreatorVideoReferenceFiles } from "../reference/infinite-canvas/src/lib/canvas/reference-file-limits";

const file = (name: string, size: number, type = "image/png") => ({ name, size, type }) as File;
const read = (target: string) => fs.readFileSync(path.join(process.cwd(), target), "utf8");

test("image draft preflight names an oversized reference instead of reporting a generic invalid parameter", () => {
    assert.throws(
        () => assertCreatorImageReferenceFiles([file("moodboard.png", 7_000_001)]),
        /参考图「moodboard\.png」.*单张不能超过 7MB/,
    );
});

test("image draft preflight preserves the server reference count and total-byte limits", () => {
    assert.throws(
        () => assertCreatorImageReferenceFiles(Array.from({ length: 9 }, (_, index) => file(`reference-${index}.png`, 1))),
        /最多 8 张/,
    );
    assert.throws(
        () => assertCreatorImageReferenceFiles(Array.from({ length: 5 }, (_, index) => file(`large-${index}.png`, 6_000_000))),
        /参考图总大小不能超过 28MB/,
    );
});

test("video draft preflight applies the image, video and audio byte limits before upload", () => {
    assert.throws(
        () => assertCreatorVideoReferenceFiles([file("start-frame.png", 7_000_001)]),
        /参考图「start-frame\.png」.*单张不能超过 7MB/,
    );
    assert.throws(
        () => assertCreatorVideoReferenceFiles([file("soundtrack.mp3", 15_000_001, "audio/mpeg")]),
        /参考音频「soundtrack\.mp3」.*单个不能超过 15MB/,
    );
    assert.throws(
        () => assertCreatorVideoReferenceFiles([file("clip.mp4", 200_000_001, "video/mp4")]),
        /参考视频「clip\.mp4」.*单个不能超过 200MB/,
    );
});

test("creator draft clients keep all selected references for validation and return the concrete API validation reason", () => {
    const imageClient = read("reference/infinite-canvas/src/services/api/image.ts");
    const videoClient = read("reference/infinite-canvas/src/services/api/video.ts");
    const imageRoute = read("app/api/creator/images/route.ts");
    const fgVideo = videoClient.slice(videoClient.indexOf("async function fgGenerateVideo"), videoClient.indexOf("function isFgCreatorVideoModel"));

    assert.match(imageClient, /assertCreatorImageReferenceFiles\(files\)/);
    assert.doesNotMatch(imageClient, /references\.slice\(0, 8\)\.map\(\(image, index\) => fgReferenceFile/);
    assert.match(fgVideo, /assertCreatorVideoReferenceFiles\(files\)/);
    assert.doesNotMatch(fgVideo, /const imageInputs = references\.slice\(0, modelSpec/);
    assert.match(imageRoute, /error instanceof Error \? error\.message/);
});
