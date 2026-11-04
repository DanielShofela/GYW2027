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
