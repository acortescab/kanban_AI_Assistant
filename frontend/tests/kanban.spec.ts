import { expect, test, type Page } from "@playwright/test";

// The backend database is shared by all tests in a run, so each test works on different cards.

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: /sign in/i }).click();
}

// The "Saving" badge is shown in the same render as the change, so once it is gone the PUT is done.
async function expectSaved(page: Page) {
  await expect(page.getByText("Saving")).toHaveCount(0);
}

test("requires sign in before loading the board", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(0);
});

test("rejects invalid credentials", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong");
  await page.getByRole("button", { name: /sign in/i }).click();

  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(0);
});

test("loads the board after sign in and returns to sign in after log out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);

  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(0);
});

test("adds a card and persists it", async ({ page }) => {
  await signIn(page);
  const column = page.getByTestId("column-col-discovery");
  await column.getByRole("button", { name: /add a card/i }).click();
  await column.getByPlaceholder("Card title").fill("Playwright card");
  await column.getByPlaceholder("Details").fill("Added via e2e.");
  await column.getByRole("button", { name: /add card/i }).click();
  await expect(column.getByText("Playwright card")).toBeVisible();
  await expectSaved(page);

  await signIn(page);
  await expect(page.getByTestId("column-col-discovery").getByText("Playwright card")).toBeVisible();
});

test("renames a column and persists it", async ({ page }) => {
  await signIn(page);
  const title = page.getByTestId("column-col-review").getByLabel("Column title");
  await title.fill("QA");
  await title.press("Enter");
  await expectSaved(page);

  await signIn(page);
  await expect(page.getByTestId("column-col-review").getByLabel("Column title")).toHaveValue("QA");
});

test("deletes a card and persists it", async ({ page }) => {
  await signIn(page);
  await page.getByTestId("card-card-6").getByRole("button", { name: /delete/i }).click();
  await expect(page.getByTestId("card-card-6")).toHaveCount(0);
  await expectSaved(page);

  await signIn(page);
  await expect(page.getByTestId("column-col-done")).toBeVisible();
  await expect(page.getByTestId("card-card-6")).toHaveCount(0);
});

test("edits a card and persists it", async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId("card-card-3");
  await card.getByRole("button", { name: /edit/i }).click();
  await card.getByLabel("Card title").fill("Edited in e2e");
  await card.getByLabel("Card details").fill("Edited details");
  await card.getByRole("button", { name: /save/i }).click();
  await expect(card.getByText("Edited in e2e")).toBeVisible();
  await expectSaved(page);

  await signIn(page);
  await expect(page.getByTestId("card-card-3").getByText("Edited in e2e")).toBeVisible();
  await expect(page.getByTestId("card-card-3").getByText("Edited details")).toBeVisible();
});

test("moves a card between columns and persists it", async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  // page.mouse does not auto-scroll, so bring the card into the viewport first.
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();
  await expectSaved(page);

  await signIn(page);
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1")
  ).toBeVisible();
});

test("applies an AI board change and persists it", async ({ page }) => {
  // The backend talks to tests/openrouter-stub.mjs, which moves card-2 to Done.
  await signIn(page);
  await expect(page.getByTestId("column-col-backlog").getByTestId("card-card-2")).toBeVisible();

  await page.getByLabel("Message to AI").fill("Move card-2 to Done");
  await page.getByRole("button", { name: /send message/i }).click();

  await expect(page.getByText("Moved card-2 to Done.")).toBeVisible();
  await expect(page.getByTestId("column-col-done").getByTestId("card-card-2")).toBeVisible();

  await signIn(page);
  await expect(page.getByTestId("column-col-done").getByTestId("card-card-2")).toBeVisible();
});
