import { strFromU8, unzip, zip, type Unzipped } from "fflate";

const MiB = 1024 * 1024;
function safePath(name: string) {
    return !!name && new TextEncoder().encode(name).length <= 240 && !/[\\:%?#\x00-\x1f\x7f]/.test(name) && name.split("/").every((part) => !!part && part !== "." && part !== "..");
}

/** Read data only; editor projects and executable files never enter the uploaded runtime ZIP. */
export async function inspectLive2DPackage(file: File) {
    if (!file.name.toLowerCase().endsWith(".zip") || !file.size || file.size > 128 * MiB) throw new Error("请选择非空且不超过 128 MiB 的 Live2D ZIP");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const files = await new Promise<Unzipped>((resolve, reject) => {
        let count = 0,
            expanded = 0;
        let problem = "";
        const paths = new Set<string>();
        unzip(
            bytes,
            {
                filter: (entry) => {
                    const name = entry.name.replace(/\/$/, "");
                    expanded += entry.originalSize;
                    if (++count > 256 || entry.originalSize > 128 * MiB || expanded > 384 * MiB) problem = "模型包内容超过限制（最多 256 个文件、展开后 384 MiB）";
                    if (!safePath(name)) problem = "模型包包含非法路径";
                    if (paths.has(name.toLowerCase())) problem = "模型包包含重复路径";
                    paths.add(name.toLowerCase());
                    if (/\.json$/i.test(name) && entry.originalSize > 2 * MiB) problem = "模型 JSON 超过 2 MiB 限制";
                    return !problem && !entry.name.endsWith("/") && /\.(json|moc3|png)$/i.test(name);
                },
            },
            (error, result) => {
                if (problem) reject(new Error(problem));
                else if (error) reject(new Error("无法读取 Live2D ZIP，请确认压缩包完整"));
                else resolve(result);
            },
        );
    });
    const entries = Object.keys(files)
        .filter((name) => name.endsWith(".model3.json"))
        .sort();
    if (!entries.length) throw new Error("压缩包中没有 model3.json 运行入口；仅有编辑工程的模型需先导出 Cubism 运行文件");
    return {
        entries,
        async build(entry: string): Promise<File> {
            if (!entries.includes(entry)) throw new Error("请选择压缩包中的一个 Live2D 模型");
            const selected: Unzipped = { [entry]: files[entry] };
            let manifest;
            try {
                manifest = JSON.parse(strFromU8(files[entry]));
            } catch {
                throw new Error("model3.json 不是有效 JSON");
            }
            if (manifest?.Version !== 3 || !manifest.FileReferences || typeof manifest.FileReferences !== "object") throw new Error("仅支持 Cubism model3.json Version 3 模型");
            const refs = manifest.FileReferences;
            const folder = entry.slice(0, entry.lastIndexOf("/") + 1);
            const include = (name: unknown, suffix: string, required = true) => {
                if (!required && (name === undefined || name === "")) return;
                if (typeof name !== "string" || !safePath(name) || !name.toLowerCase().endsWith(suffix)) throw new Error("模型资源路径或类型无效：" + String(name));
                const path = folder + name;
                if (!files[path]) throw new Error("模型缺少运行文件：" + name);
                selected[path] = files[path];
            };
            include(refs.Moc, ".moc3");
            if (!Array.isArray(refs.Textures) || !refs.Textures.length || refs.Textures.length > 8) throw new Error("模型须包含 1–8 张 PNG 纹理");
            refs.Textures.forEach((name: unknown) => include(name, ".png"));
            for (const key of ["Physics", "Pose", "DisplayInfo", "UserData"]) include(refs[key], ".json", false);
            if (refs.Expressions !== undefined && !Array.isArray(refs.Expressions)) throw new Error("模型表情引用格式无效");
            for (const expression of refs.Expressions ?? []) include(expression?.File, ".exp3.json");
            if (refs.Motions !== undefined && (!refs.Motions || typeof refs.Motions !== "object" || Array.isArray(refs.Motions))) throw new Error("模型动作引用格式无效");
            for (const group of Object.values(refs.Motions ?? {})) {
                if (!Array.isArray(group)) throw new Error("模型动作分组格式无效");
                for (const motion of group) {
                    if (motion?.Sound) throw new Error("暂不支持模型动作中的 Sound 音频，请使用不含音频引用的运行模型");
                    include(motion?.File, ".motion3.json");
                }
            }
            // Textures are already compressed; store them without a second compression pass.
            const output = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => zip(selected, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data as Uint8Array<ArrayBuffer>))));
            if (output.length > 128 * MiB) throw new Error("整理后的模型超过 128 MiB，请压缩纹理后重试");
            return new File([output], file.name.replace(/\.zip$/i, "-runtime.zip"), { type: "application/zip" });
        },
    };
}
