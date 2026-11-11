import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { Pencil, Plus } from "lucide-react";
import { fgWorkspaceBasePath } from "@/lib/fg-entry-url";
import { deleteCanvasPromptShortcut, listCanvasPromptShortcuts, saveCanvasPromptShortcut, type CanvasPromptShortcut } from "@/services/api/canvas-prompt-shortcuts";
import { useUserStore } from "@/stores/use-user-store";

type ShortcutDraft = Pick<CanvasPromptShortcut, "name" | "prompt">;
type ShortcutEdit = ShortcutDraft & { id?: string };
type ShortcutProps = { query?: string; onSelect: (prompt: string) => void };
type ShortcutAction = { kind: "save"; draft: ShortcutDraft; id?: string } | { kind: "delete"; id: string };

export function CanvasPromptShortcuts(props: ShortcutProps) {
    const user = useUserStore((state) => state.user);
    if (!user || user.email?.toLowerCase() === "test@beva.com" || typeof window === "undefined" || !fgWorkspaceBasePath(window.location.pathname)) return null;
    return <AccountPromptShortcuts key={user.id} accountId={user.id} {...props} />;
}

function AccountPromptShortcuts({ accountId, query = "", onSelect }: ShortcutProps & { accountId: string }) {
    const client = useQueryClient();
    const queryKey = ["canvas-prompt-shortcuts", accountId];
    const shortcuts = useQuery({ queryKey, queryFn: ({ signal }) => listCanvasPromptShortcuts(signal) });
    const [editing, setEditing] = useState<ShortcutEdit | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const mutation = useMutation({
        mutationFn: (action: ShortcutAction) => {
            if (useUserStore.getState().user?.id !== accountId) throw new Error("账号已切换，请重新打开快捷句");
            return action.kind === "save" ? saveCanvasPromptShortcut(action.draft, action.id) : deleteCanvasPromptShortcut(action.id);
        },
        onSuccess: () => client.invalidateQueries({ queryKey, exact: true }),
    });
    const normalized = query.trim().toLowerCase();
    const visible = shortcuts.data?.filter(({ name, prompt }) => `${name} ${prompt}`.toLowerCase().includes(normalized));

    function openEditor(next: ShortcutEdit) {
        mutation.reset();
        setConfirmDelete(false);
        setEditing(next);
    }

    async function apply(action: ShortcutAction) {
        try {
            await mutation.mutateAsync(action);
            setEditing(null);
        } catch {
            // Keep the draft open. React Query exposes the server error below the form.
        }
    }

    return (
        <section aria-label="我的快捷句" className="mb-1 border-b border-current/10 px-1 pb-1">
            <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs font-semibold">我的快捷句</span>
                <Button type="text" size="small" icon={<Plus className="size-3.5" />} disabled={!!editing || mutation.isPending} onClick={() => openEditor({ name: "", prompt: "" })}>
                    新增
                </Button>
            </div>
            {editing ? (
                <Form<ShortcutDraft>
                    key={editing.id ?? "new"}
                    layout="vertical"
                    size="small"
                    initialValues={editing}
                    className="px-1 pb-1"
                    onFinish={(draft) => { void apply({ kind: "save", draft, id: editing.id }); }}
                >
                    <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请输入名称" }]} className="mb-2!">
                        <Input autoFocus placeholder="例如：只要音效" maxLength={60} disabled={mutation.isPending} />
                    </Form.Item>
                    <Form.Item name="prompt" label="快捷句" rules={[{ required: true, whitespace: true, message: "请输入快捷句" }]} className="mb-2!">
                        <Input.TextArea rows={3} placeholder="例如：不要 BGM 和字幕，只要音效" maxLength={2000} disabled={mutation.isPending} />
                    </Form.Item>
                    {mutation.isError ? <p role="alert" className="mb-2 text-xs text-[var(--ant-color-error)]">{mutation.error.message}</p> : null}
                    {confirmDelete && editing.id ? (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                            <span className="mr-auto text-xs">删除这条快捷句？</span>
                            <Button disabled={mutation.isPending} onClick={() => setConfirmDelete(false)}>取消</Button>
                            <Button type="primary" danger loading={mutation.isPending} onClick={() => {
                                if (editing.id) void apply({ kind: "delete", id: editing.id });
                            }}>确认删除</Button>
                        </div>
                    ) : (
                        <div className="flex items-center justify-end gap-1">
                            {editing.id ? (
                                <Button className="mr-auto" type="text" danger disabled={mutation.isPending} onClick={() => setConfirmDelete(true)}>删除</Button>
                            ) : null}
                            <Button disabled={mutation.isPending} onClick={() => setEditing(null)}>取消</Button>
                            <Button type="primary" htmlType="submit" loading={mutation.isPending}>保存</Button>
                        </div>
                    )}
                </Form>
            ) : null}
            {shortcuts.isError ? (
                <div className="flex items-center justify-between px-1 text-xs" role="alert">
                    快捷句读取失败 <Button type="link" size="small" onClick={() => { void shortcuts.refetch(); }}>重试</Button>
                </div>
            ) : shortcuts.isPending ? (
                <p className="px-1 py-2 text-xs opacity-60" role="status">正在读取快捷句…</p>
            ) : !visible?.length && !editing ? (
                <p className="px-1 py-2 text-xs opacity-60">{normalized ? "没有匹配的快捷句" : "保存常用提示词，点击即可插入"}</p>
            ) : null}
            {!editing && visible?.length ? (
                <div className="thin-scrollbar max-h-40 overflow-y-auto" data-canvas-wheel-scroll>
                    {visible.map((shortcut) => (
                        <div key={shortcut.id} className="flex min-w-0 items-center gap-0.5">
                            <button type="button" className="canvas-preset-picker-option min-w-0 flex-1" onClick={() => onSelect(shortcut.prompt)}>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-semibold">{shortcut.name}</span>
                                    <span className="block truncate text-xs opacity-60">{shortcut.prompt}</span>
                                </span>
                            </button>
                            <Button type="text" size="small" aria-label={`编辑快捷句 ${shortcut.name}`} icon={<Pencil className="size-3.5" />} onClick={() => openEditor(shortcut)} />
                        </div>
                    ))}
                </div>
            ) : null}
        </section>
    );
}
