import { defineRegionScenarios } from "../support/scenarios.ts";
import { expect } from "../support/test.ts";

defineRegionScenarios("移除市场入口", [{
  name: "旧市场地址进入通用设置，保留默认模型入口",
  path: "/app/settings?section=market",
  ready: async (page) => {
    await page.getByRole("combobox", {name:"界面语言"}).waitFor();
  },
  act: async (page) => {
    const nav = page.getByRole("navigation", {name:"设置"});
    await expect(nav.getByRole("link", {name:"通用"})).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", {name:"默认模型"})).toBeInViewport();
    await expect(nav.getByRole("link", {name:"市场", exact:true})).toHaveCount(0);
    await expect(page.getByRole("heading", {name:"公司模型与工具"})).toHaveCount(0);
    await expect(page.getByRole("button", {name:/安装/})).toHaveCount(0);
  },
  screenshot: {name:"fg-removed-market-general",target:(page)=>page.getByRole("main")},
}]);
