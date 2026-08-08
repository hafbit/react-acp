import { expect, test } from "@playwright/test";

test("消息、工具、计划、配置和多会话流程", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("connection")).toHaveText("ready");
  await expect(page.getByText("Loaded demo-1", { exact: false })).toBeVisible();

  await page.getByLabel("Message").fill("hello ACP");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(
    page.getByText("Mock ACP agent completed the turn.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Inspect workspace", { exact: false })).toBeVisible();
  await expect(page.getByText("Respond", { exact: true })).toBeVisible();

  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("checkbox").click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();

  await page.getByRole("button", { name: "Second session" }).click();
  await expect(page.getByText("Loaded demo-2", { exact: false })).toBeVisible();
});
