import { expect, test } from '@playwright/test';

import { openPrimaryView, prepareDeterministicDashboard } from './helpers/dashboard';

test.describe('dashboard visual coverage', () => {
  test('home desktop shell stays stable', async ({ page }) => {
    await prepareDeterministicDashboard(page);
    await expect(page).toHaveScreenshot('dashboard-home-desktop.png');
  });

  test.describe('tablet', () => {
    test.use({ viewport: { width: 820, height: 1180 } });

    test('home tablet shell stays stable', async ({ page }) => {
      await prepareDeterministicDashboard(page);
      await expect(page).toHaveScreenshot('dashboard-home-tablet.png');
    });
  });

  test.describe('mobile', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('home mobile shell stays stable', async ({ page }) => {
      await prepareDeterministicDashboard(page);
      await expect(page).toHaveScreenshot('dashboard-home-mobile.png');
    });
  });

  test('session desktop layout stays stable in the empty-state flow', async ({ page }) => {
    await prepareDeterministicDashboard(page);
    await openPrimaryView(page, 'Salidas');
    await expect(page).toHaveScreenshot('dashboard-session-desktop.png');
  });
});
