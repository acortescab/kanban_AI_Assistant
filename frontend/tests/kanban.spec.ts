import { expect, test, type Page } from "@playwright/test";

// The backend database is shared by all tests in a run, so each test works on different
// cards or on its own freshly registered account.

async function signIn(page: Page, username = "user", password = "password") {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("board")).toBeVisible();
}

// A full page load with the session cookie: proves changes were persisted server-side.
async function reopen(page: Page) {
  await page.reload();
  await expect(page.getByTestId("board")).toBeVisible();
}

let accountCounter = 0;

// Registers a unique account (the database outlives a single test) and lands on its board.
async function register(page: Page, prefix: string) {
  accountCounter += 1;
  const username = `${prefix}${Date.now().toString(36)}${accountCounter}`;
  await page.goto("/");
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/display name/i).fill(`${prefix} person`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("My first board");
  return username;
}

// Every mutation is exactly one PUT, and each one increments this counter, so waiting for
// it to move is deterministic. Watching the "Saving" badge instead would race the render
// that produced it, and a navigation during an in-flight PUT can cancel the request.
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

// Column ids of a registered user's board are generated, so address columns by position.
const nthColumn = (page: Page, index: number) =>
  page.locator('[data-testid^="column-"]').nth(index);

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

test("the API refuses board access without a session", async ({ request }) => {
  const response = await request.get("/api/boards");
  expect(response.status()).toBe(401);
});

test("keeps the session across reloads and ends it on log out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);

  await reopen(page);

  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(0);
});

test("adds a card and persists it", async ({ page }) => {
  await signIn(page);
  const before = await saveCount(page);

  const column = await addCard(page, "col-discovery", "Playwright card", "Added via e2e.");
  await expect(column.getByText("Playwright card")).toBeVisible();
  await expectSave(page, before);

  await reopen(page);
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

  await reopen(page);
  await expect(page.getByTestId("column-col-review").getByLabel("Column title")).toHaveValue(
    "QA"
  );

  before = await saveCount(page);
  const restored = page.getByTestId("column-col-review").getByLabel("Column title");
  await restored.fill("Review");
  await restored.press("Enter");
  await expectSave(page, before);

  await reopen(page);
  await expect(
    page.getByTestId("column-col-review").getByLabel("Column title")
  ).toHaveValue("Review");
});

test("edits a card, including priority, due date and labels, and persists it", async ({ page }) => {
  await signIn(page);
  const before = await saveCount(page);
  const card = page.getByTestId("card-card-3");
  await card.getByRole("button", { name: /edit/i }).click();
  await card.getByLabel("Card title").fill("Edited in e2e");
  await card.getByLabel("Card details").fill("Edited details");
  await card.getByLabel("Card priority").selectOption("high");
  await card.getByLabel("Card due date").fill("2000-01-01");
  await card.getByLabel("Card labels").fill("e2e, urgent");
  await card.getByRole("button", { name: /save/i }).click();
  await expect(card.getByText("Edited in e2e")).toBeVisible();
  await expectSave(page, before);

  await reopen(page);
  const saved = page.getByTestId("card-card-3");
  await expect(saved.getByText("Edited in e2e")).toBeVisible();
  await expect(saved.getByText("Edited details")).toBeVisible();
  await expect(saved.getByText("high", { exact: true })).toBeVisible();
  await expect(saved.getByText("urgent", { exact: true })).toBeVisible();
  await expect(page.getByTestId("due-card-3")).toContainText("Overdue");
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

  await reopen(page);
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

  await reopen(page);
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1")
  ).toBeVisible();
});

test("a new user registers, gets a starter board, and can sign back in", async ({ page }) => {
  const username = await register(page, "reg");
  await expect(page.getByTestId("current-user")).toHaveText("reg person");
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Users" })).toHaveCount(0);

  await page.getByRole("button", { name: /log out/i }).click();
  await signIn(page, username, "password123");
  await expect(page.getByLabel("Board title")).toHaveValue("My first board");
});

test("registration rejects a taken username", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Username").fill("USER");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: /create account/i }).click();

  // Not getByRole("alert"): Next.js adds its own empty alert region (the route announcer).
  await expect(page.getByText("That username is already taken.")).toBeVisible();
});

test("manages several boards: create, switch, rename, add columns, delete", async ({ page }) => {
  await register(page, "boards");

  // Create a second board from the overview; it opens straight away.
  await page.getByRole("button", { name: "All boards" }).click();
  await page.getByLabel("New board title").fill("Launch");
  await page.getByLabel("New board description").fill("Q4 launch");
  await page.getByRole("button", { name: /create board/i }).click();
  await expect(page.getByLabel("Board title")).toHaveValue("Launch");
  await expect(page.getByLabel("Board description")).toHaveValue("Q4 launch");

  // Cards and columns are per board.
  let before = await saveCount(page);
  await nthColumn(page, 0).getByRole("button", { name: /add a card/i }).click();
  await nthColumn(page, 0).getByPlaceholder("Card title").fill("Launch task");
  await nthColumn(page, 0).getByRole("button", { name: /add card/i }).click();
  await expectSave(page, before);

  before = await saveCount(page);
  await page.getByRole("button", { name: "Add column" }).click();
  await expectSave(page, before);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(6);

  // Rename the board; the header switcher follows.
  await page.getByLabel("Board title").fill("Launch 2026");
  await page.getByLabel("Board title").press("Enter");
  await expect(page.getByLabel("Current board").locator("option:checked")).toHaveText("Launch 2026");

  // Switch back to the first board, which has neither the card nor the extra column.
  await page.getByLabel("Current board").selectOption({ label: "My first board" });
  await expect(page.getByLabel("Board title")).toHaveValue("My first board");
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await expect(page.getByText("Launch task")).toHaveCount(0);

  // Everything survives a reload, and the last opened board is reopened.
  await reopen(page);
  await expect(page.getByLabel("Board title")).toHaveValue("My first board");
  await page.getByLabel("Current board").selectOption({ label: "Launch 2026" });
  await expect(page.getByText("Launch task")).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(6);

  // Delete the first board from the overview.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "All boards" }).click();
  await page.getByRole("button", { name: "Delete board My first board" }).click();
  await expect(page.getByTestId("boards-overview")).toContainText("1 board");
  await reopen(page);
  await expect(page.getByLabel("Board title")).toHaveValue("Launch 2026");
});

test("users cannot see each other's boards", async ({ page, browser }) => {
  await register(page, "iso");
  const response = await page.request.get("/api/boards/board-1/data");
  expect(response.status()).toBe(404);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await signIn(other, "user", "password");
  await expect(other.getByLabel("Current board").locator("option")).toHaveText(["Project Board"]);
  await otherContext.close();
});

test("changes the password and deletes the account", async ({ page }) => {
  const username = await register(page, "acct");
  await page.getByRole("button", { name: "Account" }).click();

  await page.getByLabel("Display name").fill("Renamed person");
  await page.getByRole("button", { name: /save profile/i }).click();
  await expect(page.getByTestId("current-user")).toHaveText("Renamed person");

  await page.getByLabel("Current password").fill("password123");
  await page.getByLabel("New password", { exact: true }).fill("changed-pass-1");
  await page.getByLabel("Confirm new password").fill("changed-pass-1");
  await page.getByRole("button", { name: /change password/i }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();

  await page.getByRole("button", { name: /log out/i }).click();
  await signIn(page, username, "changed-pass-1");

  await page.getByRole("button", { name: "Account" }).click();
  await page.getByLabel("Confirm with your password").fill("changed-pass-1");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /delete account/i }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("changed-pass-1");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
});

test("an admin promotes and removes a user", async ({ page, browser }) => {
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const username = await register(other, "managed");

  await signIn(page);
  await page.getByRole("button", { name: "Users" }).click();
  const row = page.getByTestId(`user-row-${username}`);
  await expect(row).toContainText("managed person");

  await row.getByLabel(`Role for ${username}`).selectOption("admin");
  await other.reload();
  await expect(other.getByRole("button", { name: "Users" })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: `Delete user ${username}` }).click();
  await expect(row).toHaveCount(0);

  // The removed user's session is gone too.
  await other.reload();
  await expect(other.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await otherContext.close();
});

test("searches and filters cards", async ({ page }) => {
  await register(page, "filter");
  for (const title of ["Write release notes", "Fix login bug"]) {
    const before = await saveCount(page);
    await nthColumn(page, 0).getByRole("button", { name: /add a card/i }).click();
    await nthColumn(page, 0).getByPlaceholder("Card title").fill(title);
    await nthColumn(page, 0).getByRole("button", { name: /add card/i }).click();
    await expectSave(page, before);
  }
  // By test id: in edit mode the title moves into an input, so a hasText filter stops matching.
  const bugId = await page.locator("article").filter({ hasText: "Fix login bug" }).getAttribute("data-testid");
  const bug = page.getByTestId(bugId!);
  const before = await saveCount(page);
  await bug.getByRole("button", { name: /edit/i }).click();
  await bug.getByLabel("Card priority").selectOption("high");
  await bug.getByLabel("Card labels").fill("auth");
  await bug.getByRole("button", { name: /save/i }).click();
  await expectSave(page, before);

  await page.getByLabel("Search cards").fill("release");
  await expect(page.getByTestId("filter-count")).toHaveText("Showing 1 of 2 cards");
  await expect(page.getByText("Fix login bug")).toHaveCount(0);

  await page.getByRole("button", { name: /clear filters/i }).click();
  await page.getByLabel("Filter by label").selectOption("auth");
  await expect(page.getByText("Fix login bug")).toBeVisible();
  await expect(page.getByText("Write release notes")).toHaveCount(0);

  await page.getByRole("button", { name: /clear filters/i }).click();
  await page.getByLabel("Filter by priority").selectOption("low");
  await expect(page.getByTestId("filter-count")).toHaveText("Showing 0 of 2 cards");
});

test("shares a board, both users edit it, and a stale edit is refused", async ({ page, browser }) => {
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const memberName = await register(other, "member");
  await register(page, "owner");

  // The owner shares their starter board.
  await page.getByRole("button", { name: /members/i }).click();
  await page.getByLabel("Add member by username").fill(memberName);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByTestId("board-members")).toContainText("member person");
  await expect(page.getByTestId("member-count")).toHaveText("2");

  // The member sees it and adds a card.
  await other.reload();
  await other.getByLabel("Current board").selectOption({ index: 1 });
  await expect(other.getByTestId("shared-by")).toHaveText("Shared with you by owner person");
  let before = await saveCount(other);
  await nthColumn(other, 0).getByRole("button", { name: /add a card/i }).click();
  await nthColumn(other, 0).getByPlaceholder("Card title").fill("Added by the member");
  await nthColumn(other, 0).getByRole("button", { name: /add card/i }).click();
  await expectSave(other, before);

  // The owner's screen is now stale, so their next edit is refused and the latest board shown.
  await nthColumn(page, 1).getByRole("button", { name: /add a card/i }).click();
  await nthColumn(page, 1).getByPlaceholder("Card title").fill("Stale edit");
  await nthColumn(page, 1).getByRole("button", { name: /add card/i }).click();
  await expect(page.getByText(/someone else changed this board/i)).toBeVisible();
  await expect(page.getByText("Added by the member")).toBeVisible();
  await expect(page.getByText("Stale edit")).toHaveCount(0);

  // Retrying on the fresh board works.
  before = await saveCount(page);
  await nthColumn(page, 1).getByRole("button", { name: /add a card/i }).click();
  await nthColumn(page, 1).getByPlaceholder("Card title").fill("Owner retry");
  await nthColumn(page, 1).getByRole("button", { name: /add card/i }).click();
  await expectSave(page, before);
  await other.reload();
  await other.getByLabel("Current board").selectOption({ index: 1 });
  await expect(other.getByText("Owner retry")).toBeVisible();

  // The owner removes the member, who loses access.
  await page.getByTestId("board-members").getByRole("button", { name: /^Remove / }).click();
  await expect(page.getByTestId("member-count")).toHaveText("1");
  await other.reload();
  await expect(other.getByLabel("Current board").locator("option")).toHaveCount(1);
  await otherContext.close();
});

test("assigns a card to a member, reorders columns, and logs the activity", async ({ page, browser }) => {
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  const memberName = await register(other, "helper");
  await otherContext.close();
  await register(page, "lead");

  await page.getByRole("button", { name: /members/i }).click();
  await page.getByLabel("Add member by username").fill(memberName);
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByTestId("board-members")).toContainText("helper person");

  let before = await saveCount(page);
  await nthColumn(page, 0).getByRole("button", { name: /add a card/i }).click();
  await nthColumn(page, 0).getByPlaceholder("Card title").fill("Draft the plan");
  await nthColumn(page, 0).getByRole("button", { name: /add card/i }).click();
  await expectSave(page, before);

  const cardId = await page.locator("article").filter({ hasText: "Draft the plan" }).getAttribute("data-testid");
  const card = page.getByTestId(cardId!);
  before = await saveCount(page);
  await card.getByRole("button", { name: /edit/i }).click();
  await card.getByLabel("Card assignee").selectOption({ label: "helper person" });
  await card.getByRole("button", { name: /save/i }).click();
  await expectSave(page, before);
  await expect(card.getByLabel("Assigned to helper person")).toHaveText("HP");

  before = await saveCount(page);
  await page.getByRole("button", { name: "Move column Backlog right" }).click();
  await expectSave(page, before);

  await reopen(page);
  await expect(page.getByLabel("Column title").first()).toHaveValue("Discovery");
  await expect(page.getByTestId(cardId!).getByLabel("Assigned to helper person")).toBeVisible();

  await page.getByRole("button", { name: "Activity" }).click();
  const feed = page.getByTestId("board-activity");
  await expect(feed).toContainText("reordered the columns");
  await expect(feed).toContainText('assigned "Draft the plan" to helper person');
  await expect(feed).toContainText('added "Draft the plan" to Backlog');
  await expect(feed).toContainText("shared the board with helper person");
  await expect(feed).toContainText("created the board");
});

// Keep this last among the demo-board tests: the stub always moves card-2 to the last
// column, which the run does not undo.
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
  // The backend saved the AI's board itself, so the page sends no save of its own.
  expect(await saveCount(page)).toBe(before);

  await reopen(page);
  await expect(
    page.getByTestId("column-col-done").getByTestId("card-card-2")
  ).toBeVisible();
});
