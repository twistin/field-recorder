import { expect, test, type Locator, type Page } from '@playwright/test';

import { prepareDeterministicDashboard } from './helpers/dashboard';

async function tabUntilFocused(page: Page, target: Locator, maxSteps = 12) {
  for (let step = 0; step < maxSteps; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }

    await page.keyboard.press('Tab');
  }

  await expect(target).toBeFocused();
}

test.describe('keyboard flow', () => {
  test('desktop users can skip to main content and trigger the primary home action from keyboard', async ({ page }) => {
    await prepareDeterministicDashboard(page);

    const skipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
    const mainContent = page.getByRole('main', { name: 'Contenido principal' });
    const primaryAction = mainContent.getByRole('button', { name: 'Preparar salida', exact: true }).first();

    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(mainContent).toBeFocused();

    await tabUntilFocused(page, primaryAction);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Salidas y trabajo de campo/i })).toBeVisible();
  });

  test.describe('tablet shell', () => {
    test.use({ viewport: { width: 820, height: 1180 } });

    test('drawer traps focus and returns it to the trigger after escape', async ({ page }) => {
      await prepareDeterministicDashboard(page);

      const skipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
      const menuTrigger = page.getByRole('button', { name: 'Abrir navegación' });
      const closeButton = page.getByRole('button', { name: 'Cerrar navegación' });
      const drawer = page.locator('.fieldnotes-tablet-drawer.is-open');
      const lastFocusableDrawerItem = drawer.locator('button:visible').last();

      await page.keyboard.press('Tab');
      await expect(skipLink).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(menuTrigger).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(closeButton).toBeFocused();

      await page.keyboard.press('Shift+Tab');
      await expect(lastFocusableDrawerItem).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(closeButton).toBeFocused();

      await page.keyboard.press('Escape');
      await expect(menuTrigger).toBeFocused();
    });
  });

  test.describe('mobile shell', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('bottom navigation remains keyboard-activatable', async ({ page }) => {
      await prepareDeterministicDashboard(page);

      const bottomNav = page.getByRole('navigation', { name: 'Navegación principal móvil' });
      const projectsButton = bottomNav.getByRole('button', { name: /Proyectos/i });

      await projectsButton.focus();
      await expect(projectsButton).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: /Proyectos, fotos, audio y exportación/i })).toBeVisible();
    });
  });
});
