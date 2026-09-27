import { expect, test, type Page } from "@playwright/test";

// The backend database is shared by all tests in a run, so each test works on different
// cards, and every mutation restores what it changed.

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("board")).toBeVisible();
}

// Every mutation is exactly one PUT, and each one increments this counter, so waiting for
// it to move is deterministic. Watching the "Saving" badge instead would race the render
// that produced it, and a page.goto during an in-flight PUT can cancel the request.
async function saveCount(page: Page) {
  return Number(await page.getByTestId("board").getAttribute("data-saves-completed"));
}

async function expectSave(page: Page, previous: number) {
  await expect(page.getByTestId("board")).toHaveAttribute(
    "data-saves-completed",
    String(previous + 1)
  );
}

async function addCard(page: Page, columnId: string, title: string, details = "") {
  const column = page.getByTestId(`column-${columnId}`);
  await column.getByRole("button", { name: /add a card/i }).click();
  await column.getByPlaceholder("Card title").fill(title);
  if (details) {
    await column.getByPlaceholder("Details").fill(details);
  }
  await column.getByRole("button", { name: /add card/i }).click();
  return column;
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
  const before = await saveCount(page);

  const column = await addCard(page, "col-discovery", "Playwright card", "Added via e2e.");
  await expect(column.getByText("Playwright card")).toBeVisible();
  await expectSave(page, before);

  await signIn(page);
  await expect(
    page.getByTestId("column-col-discovery").getByText("Playwright card")
  ).toBeVisible();
});

test("renames a column and persists it, then restores the seeded title", async ({ page }) => {
  await signIn(page);
  const title = page.getByTestId("column-col-review").getByLabel("Column title");
  await expect(title).toHaveValue("Review");

  let before = await saveCount(page);
  await title.fill("QA");
  await title.press("Enter");
  await expectSave(page, before);

  await signIn(page);
  await expect(page.getByTestId("column-col-review").getByLabel("Column title")).toHaveValue(
    "QA"
  );

  before = await saveCount(page);
  const restored = page.getByTestId("column-col-review").getByLabel("Column title");
  await restored.fill("Review");
  await restored.press("Enter");
  await expectSave(page, before);

  await signIn(page);
  await expect(
    page.getByTestId("column-col-review").getByLabel("Column title")
  ).toHaveValue("Review");
});

test("edits a card and persists it", async ({ page }) => {
  await signIn(page);
  const before = await saveCount(page);
  const card = page.getByTestId("card-card-3");
  await card.getByRole("button", { name: /edit/i }).click();
  await card.getByLabel("Card title").fill("Edited in e2e");
  await card.getByLabel("Card details").fill("Edited details");
  await card.getByRole("button", { name: /save/i }).click();
  await expect(card.getByText("Edited in e2e")).toBeVisible();
  await expectSave(page, before);

  await signIn(page);
  await expect(page.getByTestId("card-card-3").getByText("Edited in e2e")).toBeVisible();
  await expect(page.getByTestId("card-card-3").getByText("Edited details")).toBeVisible();
});

test("deletes a card it created and the delete persists", async ({ page }) => {
  await signIn(page);
  let before = await saveCount(page);

  const column = await addCard(page, "col-review", "Temporary card", "Deleted below.");
  const card = column.locator("article").filter({ hasText: "Temporary card" });
  await expectSave(page, before);

  before = await saveCount(page);
  await card.getByRole("button", { name: /delete temporary card/i }).click();
  await expect(card).toHaveCount(0);
  await expectSave(page, before);

  await signIn(page);
  await expect(
    page.getByTestId("column-col-review").getByText("Temporary card")
  ).toHaveCount(0);
});

test("moves a card between columns and persists it", async ({ page }) => {
  await signIn(page);
  const before = await saveCount(page);
  const handle = page.getByTestId("card-handle-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  // page.mouse does not auto-scroll, so bring the card into the viewport first.
  await handle.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!handleBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();
  await expectSave(page, before);

  await signIn(page);
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1")
  ).toBeVisible();
});

// Keep this last: the stub always moves card-2 to Done, which the run does not undo.
test("applies an AI board change and persists it", async ({ page }) => {
  // The backend talks to tests/openrouter-stub.mjs, which moves card-2 to Done.
  await signIn(page);
  await expect(
    page.getByTestId("column-col-backlog").getByTestId("card-card-2")
  ).toBeVisible();
  const before = await saveCount(page);

  await page.getByLabel("Message to AI").fill("Move card-2 to Done");
  await page.getByRole("button", { name: /send message/i }).click();

  await expect(page.getByText("Moved card-2 to Done.")).toBeVisible();
  await expect(page.getByTestId("column-col-done").getByTestId("card-card-2")).toBeVisible();
  await expectSave(page, before);

  await signIn(page);
  await expect(
    page.getByTestId("column-col-done").getByTestId("card-card-2")
  ).toBeVisible();
});
