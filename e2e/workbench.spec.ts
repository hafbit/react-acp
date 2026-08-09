import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("connection")).toHaveText("ready");
  await expect(page.getByText("Loaded demo-1 on connection 2", { exact: false })).toBeVisible();
});

test("消息回传合并、工具、计划和配置流程", async ({ page }) => {
  await page.getByLabel("Message").fill("hello ACP");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Mock ACP agent completed the turn.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Inspect workspace", { exact: false })).toBeVisible();
  await expect(page.getByText("Respond", { exact: true })).toBeVisible();
  await expect(page.locator('article[data-role="user"]')).toHaveCount(1);
  await expect(page.locator('article[data-role="user"]')).toContainText("hello ACP");

  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("checkbox").click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

test("重连后重新挂载当前 session", async ({ page }) => {
  await page.getByRole("button", { name: "Drop connection" }).click();
  await expect(page.getByTestId("connection")).toHaveText("closed");
  await page.getByRole("button", { name: "Reconnect" }).click();
  await expect(page.getByTestId("connection")).toHaveText("ready");
  await expect(page.getByText("Loaded demo-1 on connection 3", { exact: false })).toBeVisible();
});

test("快速切换 session 时最新选择获胜", async ({ page }) => {
  await page.getByRole("button", { name: "Slow session" }).click();
  await page.getByRole("button", { name: "Fast session" }).click();

  await expect(page.getByRole("button", { name: "Fast session" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByText("Loaded demo-fast", { exact: false })).toBeVisible();
  await page.waitForTimeout(200);
  await expect(page.getByRole("button", { name: "Fast session" })).toHaveAttribute(
    "data-active",
    "true",
  );
});
