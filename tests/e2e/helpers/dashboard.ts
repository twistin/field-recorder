import { expect, type Page } from '@playwright/test';

const FIXED_NOW_ISO = '2026-04-19T08:30:00.000Z';

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function prepareDeterministicDashboard(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.route('https://fonts.googleapis.com/**', async (route) => {
    await route.abort();
  });

  await page.route('https://fonts.gstatic.com/**', async (route) => {
    await route.abort();
  });

  await page.route('**/api/catalog/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.addInitScript(({ fixedNowIso }) => {
    const NativeDate = Date;
    const fixedTimestamp = new NativeDate(fixedNowIso).getTime();

    class FixedDate extends NativeDate {
      constructor(...args: any[]) {
        if (args.length === 0) {
          super(fixedTimestamp);
          return;
        }

        super(args[0]);
      }

      static now() {
        return fixedTimestamp;
      }

      static parse(value: string) {
        return NativeDate.parse(value);
      }

      static UTC(...args: Parameters<typeof Date.UTC>) {
        return NativeDate.UTC(...args);
      }
    }

    // Keep dashboard timestamps and greetings stable for screenshots.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Date = FixedDate;

    const permissionDeniedError = {
      code: 1,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
      message: 'Geolocation denied for deterministic tests.',
    };

    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition(_success: PositionCallback, error?: PositionErrorCallback) {
          error?.(permissionDeniedError as GeolocationPositionError);
        },
        watchPosition(_success: PositionCallback, error?: PositionErrorCallback) {
          error?.(permissionDeniedError as GeolocationPositionError);
          return 1;
        },
        clearWatch() {
          return undefined;
        },
      },
    });

    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // Ignore storage failures in the test harness.
    }
  }, { fixedNowIso: FIXED_NOW_ISO });

  await page.goto('/');
  await expect(page.getByRole('main', { name: 'Contenido principal' })).toBeVisible();
}

export async function openPrimaryView(page: Page, label: 'Inicio' | 'Salidas' | 'Captura' | 'Archivo') {
  const labelPattern = new RegExp(`^${escapeRegex(label)}`, 'i');
  const desktopNavButton = page.locator('.sidebar-nav:visible .dock-button', { hasText: labelPattern });

  if (await desktopNavButton.count()) {
    await desktopNavButton.first().click();
    return;
  }

  await page
    .locator('.mobile-dock:visible .dock-button', { hasText: labelPattern })
    .first()
    .click();
}
