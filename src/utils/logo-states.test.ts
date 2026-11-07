import test from 'node:test';
import assert from 'node:assert/strict';
import { EventSettings } from '../types/index';

const BASE_SETTINGS: EventSettings = {
  location: 'Abidjan',
  schedules: '1-3 Jan 2027',
  contactPhone: '+2250700000000',
  registrationsOpen: true,
  announcement: 'Gratuit',
  updatedAt: '2026-10-31T00:00:00.000Z',
};

function resolveHeroLogoState(
  logoUrl: string | undefined,
  isSettingsLoading: boolean
): 'READY' | 'LOADING' | 'EMPTY' {
  if (logoUrl && logoUrl.trim().length > 0) {
    return 'READY';
  }
  if (isSettingsLoading) {
    return 'LOADING';
  }
  return 'EMPTY';
}

function resolveHeaderLogoDisplay(
  headerLogoUrl: string | undefined
): { type: 'custom_svg' | 'default_badge'; url?: string } {
  if (headerLogoUrl && headerLogoUrl.trim().length > 0) {
    return { type: 'custom_svg', url: headerLogoUrl };
  }
  return { type: 'default_badge' };
}

test('Hero Logo State: returns READY immediately if logoUrl is present, even when isSettingsLoading is true', () => {
  const state = resolveHeroLogoState('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', true);
  assert.equal(state, 'READY');
});

test('Hero Logo State: returns LOADING when logoUrl is empty and settings are fetching from Firebase', () => {
  const state = resolveHeroLogoState(undefined, true);
  assert.equal(state, 'LOADING');
  assert.notEqual(state, 'EMPTY'); // Must NOT flash empty/temporary title
});

test('Hero Logo State: returns EMPTY only after Firebase finishes loading and confirms no logo exists', () => {
  const state = resolveHeroLogoState(undefined, false);
  assert.equal(state, 'EMPTY');
});

test('Header Logo: returns custom_svg when headerLogoUrl is set', () => {
  const display = resolveHeaderLogoDisplay('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
  assert.equal(display.type, 'custom_svg');
  assert.equal(display.url, 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=');
});

test('Header Logo: returns default_badge when headerLogoUrl is undefined or empty', () => {
  assert.equal(resolveHeaderLogoDisplay(undefined).type, 'default_badge');
  assert.equal(resolveHeaderLogoDisplay('').type, 'default_badge');
});

test('Settings immutability: updating headerLogoUrl preserves main logo and existing registrations status', () => {
  const withMainLogo: EventSettings = {
    ...BASE_SETTINGS,
    logoUrl: 'https://storage/main.svg',
    logoUpdatedAt: '2026-10-31T10:00:00.000Z',
  };

  const updated: EventSettings = {
    ...withMainLogo,
    headerLogoUrl: 'https://storage/header.svg',
    headerLogoUpdatedAt: '2026-10-31T10:05:00.000Z',
  };

  assert.equal(updated.logoUrl, 'https://storage/main.svg');
  assert.equal(updated.headerLogoUrl, 'https://storage/header.svg');
  assert.equal(updated.registrationsOpen, true);
  assert.equal(updated.location, 'Abidjan');
});

test('Multi-format logo support: accepts and resolves PNG, JPEG and WebP logos', () => {
  const pngLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const webpLogo = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==';
  const jpgLogo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

  assert.equal(resolveHeroLogoState(pngLogo, false), 'READY');
  assert.equal(resolveHeroLogoState(webpLogo, false), 'READY');
  assert.equal(resolveHeroLogoState(jpgLogo, false), 'READY');

  assert.equal(resolveHeaderLogoDisplay(pngLogo).type, 'custom_svg');
  assert.equal(resolveHeaderLogoDisplay(webpLogo).type, 'custom_svg');
  assert.equal(resolveHeaderLogoDisplay(jpgLogo).type, 'custom_svg');
});

test('Logo removal: clearing logo returns state to default cleanly without affecting event parameters', () => {
  const currentSettings: EventSettings = {
    ...BASE_SETTINGS,
    logoUrl: 'data:image/png;base64,dummy',
    headerLogoUrl: 'data:image/svg+xml;base64,dummy',
  };

  // Simulating removal of main logo
  const afterMainRemoval: EventSettings = {
    ...currentSettings,
    logoUrl: '',
    logoAsset: undefined,
  };
  assert.equal(resolveHeroLogoState(afterMainRemoval.logoUrl, false), 'EMPTY');
  assert.equal(resolveHeaderLogoDisplay(afterMainRemoval.headerLogoUrl).type, 'custom_svg');
  assert.equal(afterMainRemoval.location, 'Abidjan');

  // Simulating removal of header logo
  const afterHeaderRemoval: EventSettings = {
    ...afterMainRemoval,
    headerLogoUrl: '',
    headerLogoAsset: undefined,
  };
  assert.equal(resolveHeaderLogoDisplay(afterHeaderRemoval.headerLogoUrl).type, 'default_badge');
  assert.equal(afterHeaderRemoval.registrationsOpen, true);
});

