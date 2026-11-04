import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorizedAdmin } from './security';
import { EventSettings } from '../types/index';

test('Settings Update Authorization: unauthenticated user is strictly rejected', () => {
  const result = isAuthorizedAdmin(null);
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'NOT_AUTHENTICATED');
});

test('Settings Update Authorization: non-whitelisted email is strictly rejected', () => {
  const result = isAuthorizedAdmin({
    uid: 'random-user-1',
    email: 'hacker@example.com',
    email_verified: true,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'EMAIL_NOT_AUTHORIZED');
});

test('Settings Update Authorization: primary admin with verified email is authorized', () => {
  const result = isAuthorizedAdmin({
    uid: 'primary-admin-uid',
    email: 'digitalsoutien@gmail.com',
    email_verified: true,
  });
  assert.equal(result.authorized, true);
  assert.equal(result.reason, 'AUTHORIZED_PRIMARY_ADMIN');
});

test('Settings Update Authorization: unverified admin email is strictly rejected', () => {
  const result = isAuthorizedAdmin({
    uid: 'spoofed-uid',
    email: 'digitalsoutien@gmail.com',
    email_verified: false,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'EMAIL_NOT_VERIFIED');
});

test('Settings Payload Merge: updating event settings strictly retains existing logoUrl and headerLogoUrl', () => {
  const initialSettings: EventSettings = {
    location: 'Abidjan',
    schedules: '1-3 Jan 2027',
    contactPhone: '+2250700000000',
    registrationsOpen: true,
    logoUrl: 'https://firebasestorage.app/logo-main.svg',
    logoUpdatedAt: '2026-10-31T12:00:00Z',
    headerLogoUrl: 'https://firebasestorage.app/logo-header.svg',
    headerLogoUpdatedAt: '2026-10-31T12:05:00Z',
    updatedAt: '2026-10-31T12:05:00Z',
  };

  const partialUpdate: Partial<EventSettings> = {
    location: 'Palais des Congrès de Sofitel Abidjan',
    contactPhone: '+2250711223344',
  };

  const merged: EventSettings = {
    ...initialSettings,
    ...partialUpdate,
    updatedAt: '2026-10-31T13:00:00Z',
  };

  assert.equal(merged.location, 'Palais des Congrès de Sofitel Abidjan');
  assert.equal(merged.contactPhone, '+2250711223344');
  assert.equal(merged.logoUrl, 'https://firebasestorage.app/logo-main.svg');
  assert.equal(merged.headerLogoUrl, 'https://firebasestorage.app/logo-header.svg');
  assert.equal(merged.registrationsOpen, true);
});
