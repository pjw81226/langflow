import type { Page } from "@playwright/test";
import { seedFlowIfEmpty } from "./flow/seed-flow-if-empty";

/**
 * Bootstraps a fresh Langflow install by creating a "Basic Prompting" flow
 * from the templates modal so subsequent assertions have a valid project
 * sidebar to work against. The empty-page CTA opens the templates modal
 * directly.
 */
export const addFlowToTestOnEmptyLangflow = async (page: Page) => {
  await seedFlowIfEmpty(page);
};
