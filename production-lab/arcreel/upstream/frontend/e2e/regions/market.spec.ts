import { defineRegionScenarios } from "../support/scenarios.ts";
import { expect } from "../support/test.ts";

defineRegionScenarios("公司管理市场", [{
  name: "空市场说明及公司模型入口在全部支持视口可见",
  path: "/app/settings?section=market",
  ready: async (page) => {
    await page.getByRole("heading", {name:"公司模型与工具"}).waitFor();
  },
  act: async (page) => {
    await expect(page.getByRole("link", {name:"查看默认模型"})).toBeInViewport();
    await expect(page.getByRole("button", {name:/安装/})).toHaveCount(0);
  },
  screenshot: {name:"fg-company-market",target:(page)=>page.getByRole("main")},
}]);
