import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getActiveUserScope } from "@/lib/user-scope";
import { getSkill, listAddedSkills, listSkills } from "@/services/api/skills";

export function useDramaSkillCatalog(open: boolean, keyword: string, selectedId: string) {
    const [scope, setScope] = useState<"mine" | "public">("mine");
    const [page, setPage] = useState(1);
    const search = useDebouncedValue(keyword.trim(), 250);
    const user = getActiveUserScope();
    const added = useQuery({
        queryKey: ["skills", "added", user],
        queryFn: listAddedSkills,
        enabled: open,
        staleTime: 30_000,
    });
    const market = useQuery({
        queryKey: ["skills", "public", user, search, page],
        queryFn: () => listSkills({ scope: "public", sort: "updated", search, page, pageSize: 24 }),
        enabled: open && scope === "public" && keyword.trim() === search,
        staleTime: 30_000,
    });
    const addedSkills = added.data?.skills ?? [];
    const marketSkills = market.data?.skills ?? [];
    const listedSelection = [...addedSkills, ...marketSkills].find((item) => item.skillId === selectedId);
    const selection = useQuery({
        queryKey: ["skills", "detail", user, selectedId],
        queryFn: () => getSkill(selectedId),
        enabled: open && !!selectedId && !listedSelection,
        staleTime: 30_000,
    });
    const current = scope === "mine" ? added : market;
    const items = scope === "mine"
        ? addedSkills.filter((skill) => `${skill.skillName} ${skill.description}`.toLowerCase().includes(keyword.trim().toLowerCase()))
        : marketSkills;
    return {
        scope,
        setScope,
        page,
        setPage,
        hasMore: market.data?.hasMore ?? false,
        items,
        selected: listedSelection ?? selection.data?.skill,
        isLoading: current.isLoading,
        isError: current.isError,
    };
}
