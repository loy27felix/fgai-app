import { http } from "./request";

export type MeilinCompanion = { userId: string; name: string; resourceId: string; height: number; revision: number };

export const getMeilinCompanion = () => http.get<MeilinCompanion>("/agent/companion");
export const updateMeilinCompanion = (value: MeilinCompanion) => http.put<MeilinCompanion>("/agent/companion", value);
