import { useQuery } from "@tanstack/react-query";
import { useUserStore } from "@/stores/use-user-store";
import { getMeilinCompanion } from "@/services/api/meilin-companion";
import { getResourceAccess, resourceStorageKey } from "@/services/api/resources";

export function useMeilinCompanion() {
    const userId = useUserStore((state) => state.user?.id);
    const queryKey = ["meilin-companion", userId];
    const setting = useQuery({
        queryKey,
        queryFn: async () => {
            const value = await getMeilinCompanion();
            if (value.userId !== userId) throw new Error("登录账号已切换，请重新读取助手设置");
            return value;
        },
        enabled: !!userId,
        staleTime: 30_000,
    });
    const resourceId = setting.data?.resourceId;
    const image = useQuery({
        queryKey: [...queryKey, "image", resourceId],
        queryFn: () => getResourceAccess(resourceStorageKey(resourceId!)),
        enabled: !!userId && !!resourceId,
        staleTime: 60_000,
        refetchInterval: 240_000,
    });
    return { ...setting, queryKey, imageUrl: image.data?.url ?? "", imageError: image.error };
}
