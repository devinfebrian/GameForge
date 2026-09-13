import { expect, test } from "@playwright/test";
import { e2eEnvironment } from "./env";

test.skip(
  e2eEnvironment === null,
  "Requires .env.e2e.local pointing at a dedicated Supabase project. See .env.e2e.example.",
);

test.beforeEach(async ({ page }) => {
  if (e2eEnvironment === null) {
    return;
  }

  await page.goto("/login");
  await page.getByLabel("Email").fill(e2eEnvironment.email);
  await page.getByLabel("Password").fill(e2eEnvironment.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("link", { name: "Studio" })).toBeVisible();
});

test("generates a game, patches it, and rolls back a version", async ({ page }) => {
  const status = page.getByTestId("sandbox-status");

  // --- Generate ---
  await page.goto("/studio/new");
  await page
    .getByLabel("Describe your game")
    .fill("A drifting square that bounces off the walls and collects coins");
  await page.getByRole("button", { name: "Generate" }).click();

  // SCENE_READY means create() returned without throwing, so this is the
  // end-to-end assertion that the generated code actually boots.
  await expect(status).toContainText("running", { timeout: 60_000 });

  // The first completed run navigates to the game's own route.
  await expect(page).toHaveURL(/\/studio\/[0-9a-fA-F-]{36}$/);
  await expect(page.getByTestId("version-1")).toContainText("current");

  // --- Transport controls ---
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(status).toContainText("paused");

  await page.getByRole("button", { name: "Play" }).click();
  await expect(status).toContainText("running");

  await page.getByRole("button", { name: "Restart" }).click();
  await expect(status).toContainText("running", { timeout: 30_000 });

  // Mute is asserted at the control level only: whether audio actually stopped
  // is not observable in a headless browser, and claiming otherwise would be a
  // test that lies.
  await page.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible();

  // --- Patch ---
  await page.getByLabel("Ask for a change").fill("Make the player twice as fast");
  await page.getByRole("button", { name: "Apply change" }).click();

  await expect(page.getByTestId("version-2")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("version-2")).toContainText("current");
  await expect(status).toContainText("running", { timeout: 60_000 });

  // --- Roll back ---
  await page.getByTestId("version-1").getByRole("button", { name: "Roll back" }).click();

  // Repointing current_version_id does not create a version, so v2 must still be
  // present while the badge moves back.
  await expect(page.getByTestId("version-1")).toContainText("current");
  await expect(page.getByTestId("version-2")).toBeVisible();
  await expect(status).toContainText("running", { timeout: 60_000 });
});

test("disables submit while a run is streaming", async ({ page }) => {
  await page.goto("/studio/new");
  await page.getByLabel("Describe your game").fill("A game about waiting");

  const generate = page.getByRole("button", { name: "Generate" });

  // The UI guard: the button must not accept a second submit before React has
  // re-rendered it. The server's 409 (beginGenerationRun returning null) is
  // covered by lib/games/run-guard.test.ts and cannot be raced deterministically
  // here — the fake pipeline finishes too fast to hold the slot open.
  await generate.click();
  await expect(generate).toBeDisabled();

  await expect(page.getByTestId("sandbox-status")).toContainText("running", {
    timeout: 60_000,
  });
});
