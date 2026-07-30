import { useState } from "react";
import { Button, Tooltip } from "antd";
import { BookOpen } from "lucide-react";

import { PromptSelectDialog } from "@/reference/infinite-canvas/src/components/prompts/prompt-select-dialog";
import { canvasThemes } from "@/reference/infinite-canvas/src/lib/canvas-theme";
import { useThemeStore } from "@/reference/infinite-canvas/src/stores/use-theme-store";

export function CanvasPromptLibrary({ onSelect }: { onSelect: (prompt: string) => void }) {
    const [open, setOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <>
            <Tooltip title="提示词库">
                <Button
                    type="text"
                    className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0"
                    style={{ color: theme.node.text }}
                    icon={<BookOpen className="size-3.5" />}
                    onClick={() => setOpen(true)}
                    aria-label="提示词库"
                />
            </Tooltip>
            <PromptSelectDialog open={open} onOpenChange={setOpen} onSelect={onSelect} />
        </>
    );
}
