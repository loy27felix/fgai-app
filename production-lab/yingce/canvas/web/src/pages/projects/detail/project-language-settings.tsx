import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Select } from "antd";
import { getProjectLanguage, saveProjectLanguage, type ProjectLanguagePolicy } from "@/services/api/project-language";
import { useUserStore } from "@/stores/use-user-store";

export function ProjectLanguageSettings({ projectId }: { projectId: string }) {
    const scope = useUserStore(state => state.user?.id || "");
    const queryClient = useQueryClient(), { message } = App.useApp();
    const queryKey = ["project-language", scope, projectId];
    const query = useQuery({ queryKey, queryFn: () => getProjectLanguage(projectId) });
    const [policy, setPolicy] = useState<ProjectLanguagePolicy>();
    useEffect(() => { setPolicy(query.data?.policy); }, [projectId, scope, query.data]);
    const save = useMutation({ mutationFn: () => saveProjectLanguage(projectId, query.data!, policy!), onSuccess: setting => {
        queryClient.setQueryData(queryKey, setting); void queryClient.invalidateQueries({ queryKey: ["project-language"] }); message.success("项目语言设置已保存，后续生成会沿用；已有内容保留");
    }, onError: error => message.error(error.message) });
    return <section className="border-t border-border/70 py-5">
        <h3 className="mb-2 text-sm font-semibold">对白与画面语言</h3>
        <p className="mb-3 text-xs text-foreground/55">统一用于后续资产、分镜、视频与角色试音。后台名称和制作说明可保留中文；已有产物不会自动重做。</p>
        {query.error && <Alert type="error" showIcon title="语言设置读取失败，请重试" action={<Button onClick={() => void query.refetch()}>重试</Button>} />}
        {policy && <div className="flex flex-wrap items-end gap-4">
            <label className="grid gap-1 text-xs">对白 / 旁白<Select className="min-w-64" value={policy.spoken} onChange={spoken => setPolicy({ ...policy, spoken })} options={[{ value: "source", label: "跟随原稿" }, { value: "en-original", label: "英语 · 逐字沿用原英文台词" }]} /></label>
            <label className="grid gap-1 text-xs">画面文字<Select className="min-w-48" value={policy.screenText} onChange={screenText => setPolicy({ ...policy, screenText })} options={[{ value: "source", label: "跟随原稿" }, { value: "no-zh", label: "禁止中文文字与字幕" }, { value: "none", label: "不出现任何文字" }]} /></label>
            <Button type="primary" disabled={!query.data || JSON.stringify(policy) === JSON.stringify(query.data.policy)} loading={save.isPending} onClick={() => save.mutate()}>保存语言设置</Button>
        </div>}
        {policy?.spoken === "en-original" && <p className="mt-3 text-xs text-foreground/65">中英对照只使用原稿英文，中文用于理解。修改运镜、表演或时长时保留英文原句；找不到对应原句会提示核对，不自动翻译或润色。</p>}
    </section>;
}
