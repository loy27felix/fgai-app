import { http } from "./request";
import type { PersonalAppearance } from "@/stores/use-personal-appearance-store";

export const getPersonalAppearance = (signal?: AbortSignal) => http.get<PersonalAppearance>("/me/appearance", { signal });
export const savePersonalAppearance = (value: PersonalAppearance) => http.put<PersonalAppearance>("/me/appearance", value);
