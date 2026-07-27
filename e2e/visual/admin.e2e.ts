import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures";
import { makeCampaign, makeEvent, makeTicket, testEmail } from "../helpers/db";

test.skip(
  !process.env.CI && process.env.VISUAL !== "1",
  "visual suite is opt-in locally",
);

async function stabilize(page: Page, path: string): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(path);
  await page.waitForFunction(() => document.readyState === "complete");
  await page.waitForTimeout(100);
  await page.addStyleTag({
    content:
      "*,*::before,*::after{caret-color:transparent!important;animation:none!important;transition:none!important}",
  });
}

test("dashboard visual", async ({ superadminPage }) => {
  await makeEvent({ name: "Visual Dashboard Event" });
  await stabilize(superadminPage, "/");
  await expect(superadminPage).toHaveScreenshot("admin-dashboard.png", {
    animations: "disabled",
    mask: [superadminPage.getByText(/In \d+ days/)],
  });
});

test("tickets list visual", async ({ superadminPage }) => {
  const event = await makeEvent({ name: "Visual Tickets Event" });
  await makeTicket({
    eventId: event.id,
    email: testEmail("visual-ticket"),
    name: "Visual Ticket Holder",
  });
  await stabilize(superadminPage, `/tickets/${event.id}`);
  await expect(superadminPage).toHaveScreenshot("admin-tickets.png", {
    animations: "disabled",
  });
});

test("check-in visual", async ({ superadminPage }) => {
  const event = await makeEvent({ name: "Visual Check-in Event", live: true });
  await makeTicket({
    eventId: event.id,
    email: testEmail("visual-checkin"),
    name: "Visual Check-in Guest",
  });
  await stabilize(superadminPage, `/check-in/${event.id}`);
  await expect(superadminPage).toHaveScreenshot("admin-check-in.png", {
    animations: "disabled",
  });
});

test("summary charts visual", async ({ superadminPage }) => {
  const event = await makeEvent({ name: "Visual Summary Event" });
  await makeTicket({
    eventId: event.id,
    email: testEmail("visual-summary-present"),
    scanned: true,
  });
  await makeTicket({
    eventId: event.id,
    email: testEmail("visual-summary-absent"),
  });
  await stabilize(superadminPage, `/summary/${event.id}`);
  await superadminPage.waitForTimeout(1_200);
  await expect(superadminPage).toHaveScreenshot("admin-summary.png", {
    animations: "disabled",
    mask: [superadminPage.locator("time")],
  });
});

test("campaign list visual", async ({ superadminPage }) => {
  const event = await makeEvent({ name: "Visual Campaign Event" });
  await makeCampaign({
    subject: "Visual Campaign Draft",
    eventId: event.id,
  });
  await stabilize(superadminPage, "/campaigns");
  await expect(superadminPage).toHaveScreenshot("admin-campaigns.png", {
    animations: "disabled",
    mask: [superadminPage.locator("time")],
  });
});

test("campaign editor visual", async ({ superadminPage }) => {
  const event = await makeEvent({ name: "Visual Campaign Editor Event" });
  const campaign = await makeCampaign({
    subject: "Visual Campaign Editor",
    body: "<p>Deterministic visual campaign body.</p>",
    eventId: event.id,
  });
  await stabilize(superadminPage, `/campaigns/${campaign.id}`);
  await expect(superadminPage).toHaveScreenshot("admin-campaign-editor.png", {
    animations: "disabled",
    mask: [superadminPage.locator("time")],
  });
});
