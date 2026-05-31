import { expect, test } from '@playwright/test';

import { openPrimaryView, prepareDeterministicDashboard, seedFieldSessions } from './helpers/dashboard';

const ACTIVE_CAPTURE_SESSION = {
  id: 'session-visual-active',
  name: 'Salida visual',
  projectName: 'Proyecto visual',
  region: 'Costa de prueba',
  notes: 'Ruta costera con atención a oleaje, viento y aves.',
  createdAt: '2026-04-19T08:15:00.000Z',
  startedAt: '2026-04-19T08:15:00.000Z',
  status: 'active' as const,
  equipmentPreset: 'Zoom H6 · XY',
  points: [
    {
      id: 'point-visual-1',
      createdAt: '2026-04-19T08:22:00.000Z',
      gps: { lat: 42.2406, lon: -8.7207, accuracy: 8 },
      placeName: 'Praia de proba',
      habitat: 'Costa rocosa',
      characteristics: 'Oleaje suave y gaviotas en primer plano',
      observedWeather: 'Nuboso con viento moderado',
      automaticWeather: {
        summary: '16 °C · NW 12 km/h',
        details: 'Brisa constante y nubosidad media.',
        fetchedAt: '2026-04-19T08:22:00.000Z',
      },
      detectedPlace: {
        placeName: 'Praia de proba',
        context: 'Cangas, Galicia',
        displayName: 'Praia de proba, Cangas, Galicia',
        fetchedAt: '2026-04-19T08:22:00.000Z',
      },
      soundscapeClassification: {
        summary: 'Agua, viento y aves',
        details: 'Predominan el oleaje, el viento costero y gaviotas dispersas.',
        tags: ['agua', 'viento', 'aves'],
        detectedAt: '2026-04-19T08:22:00.000Z',
        durationSeconds: 15,
        engine: 'local-passive-v2' as const,
      },
      tags: ['costa', 'mañana'],
      notes: 'Primer punto de escucha junto a las rocas.',
      zoomTakeReference: 'H6-001',
      microphoneSetup: 'Zoom H6 · XY',
      photos: [],
    },
  ],
  audioTakes: [],
  routePlan: null,
  cloudSyncStatus: 'synced' as const,
  catalogSyncStatus: 'synced' as const,
};

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

  test('capture desktop layout stays stable with an active session', async ({ page }) => {
    await prepareDeterministicDashboard(page);
    await seedFieldSessions(page, [ACTIVE_CAPTURE_SESSION]);
    await openPrimaryView(page, 'Captura');

    await expect(page.getByRole('button', { name: 'Guardar registro rápido', exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot('dashboard-capture-desktop.png');
  });
});
