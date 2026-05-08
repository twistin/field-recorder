import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { openPrimaryView, prepareDeterministicDashboard } from './helpers/dashboard';

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blockingViolations = results.violations.filter((violation) =>
    violation.impact === 'serious' || violation.impact === 'critical',
  );

  expect(blockingViolations).toEqual([]);
}

test.describe('axe accessibility checks', () => {
  test('dashboard shell and summary do not introduce serious violations', async ({ page }) => {
    await prepareDeterministicDashboard(page);
    await expectNoSeriousAxeViolations(page);
  });

  test('session and archive shells stay free of serious violations in empty-state flows', async ({ page }) => {
    await prepareDeterministicDashboard(page);

    await openPrimaryView(page, 'Salidas');
    await expect(page.getByRole('heading', { name: /Preparar y retomar salidas/i })).toBeVisible();
    await expectNoSeriousAxeViolations(page);

    await openPrimaryView(page, 'Archivo');
    await expect(page.getByRole('heading', { name: /Archivo, media y exportación/i })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });
});
