import { expect, type Page } from "@playwright/test";
import { TID } from "../constants/testIds";
import { TIMEOUTS } from "../constants/timeouts";

export async function selectStarterTemplate(
  page: Page,
  templateName: string,
): Promise<string> {
  await page.getByTestId(TID.sideNavAllTemplates).click();
  const template = page
    .getByRole("dialog")
    .getByTestId(`template-${templateName.replace(/ /g, "-").toLowerCase()}`);
  await expect(template).toBeVisible({ timeout: TIMEOUTS.standard });

  const [createResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/flows/",
      // Creating a starter flow does real backend work (template hydration,
      // folder wiring) and can outlive the default action timeout on slow
      // Windows CI runners.
      { timeout: TIMEOUTS.long },
    ),
    template.click(),
  ]);
  expect(
    createResponse.ok(),
    `Creating starter template ${templateName} returned ${createResponse.status()}`,
  ).toBe(true);

  const createdFlow = await createResponse.json();
  const createdFlowId = (createdFlow as { id?: unknown })?.id;
  expect(
    typeof createdFlowId === "string" && createdFlowId.length > 0,
    `Creating starter template ${templateName} returned no flow id`,
  ).toBe(true);

  await page.waitForURL(
    (url) =>
      new RegExp(`^/flow/${createdFlowId}(?:/folder/[^/?#]+)?/?$`).test(
        url.pathname,
      ),
    { timeout: TIMEOUTS.standard },
  );

  return createdFlowId as string;
}
