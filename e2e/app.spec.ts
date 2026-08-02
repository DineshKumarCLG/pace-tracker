import { test, expect } from "@playwright/test";

test("authenticated shell renders and mobile navigation remains usable", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator("main h1")).toContainText("Good ");
  await expect(page.getByRole("link", { name: "Tasks" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Team" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page).toHaveURL(/\/team$/);
  await expect(page.locator("main h1")).toHaveText("Team");

  expect(consoleErrors).toEqual([]);
});
