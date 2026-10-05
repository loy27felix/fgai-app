import { Link } from "wouter";
import { settingsSectionPath } from "@/app-routes";
import {useTranslation} from "react-i18next";

export function FGManagedMarketSection() {
  const {t}=useTranslation("dashboard");
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">{t("fg_managed_market_title")}</h2>
      <div className="rounded-lg border border-border bg-card p-5 text-sm leading-7">
        <p>{t("fg_managed_market_policy")}</p>
        <p>{t("fg_managed_market_empty")}</p>
        <p>{t("fg_managed_market_models")}</p>
        <Link className="text-primary underline" href={settingsSectionPath("default-models")}>{t("fg_managed_market_link")}</Link>
      </div>
    </div>
  );
}
