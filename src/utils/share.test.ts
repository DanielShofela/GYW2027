import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFICIAL_SITE_URL,
  buildWhatsAppShareMessage,
  buildWhatsAppShareUrl,
} from './share';
import { translations } from '../i18n/translations';

test('OFFICIAL_SITE_URL points to https://gy2027.netlify.app/', () => {
  assert.equal(OFFICIAL_SITE_URL, 'https://gy2027.netlify.app/');
});

test('buildWhatsAppShareMessage appends official site URL cleanly for FR and EN', () => {
  const frMessage = buildWhatsAppShareMessage(translations.fr.whatsappShareText);
  assert.ok(frMessage.endsWith('https://gy2027.netlify.app/'));
  assert.equal(frMessage.includes('ais-pre'), false);
  assert.equal(frMessage.includes('ais-dev'), false);

  const enMessage = buildWhatsAppShareMessage(translations.en.whatsappShareText);
  assert.ok(enMessage.endsWith('https://gy2027.netlify.app/'));
});

test('buildWhatsAppShareUrl produces valid WhatsApp send URL containing encoded official URL', () => {
  const url = buildWhatsAppShareUrl(translations.fr.whatsappShareText);
  assert.ok(url.startsWith('https://api.whatsapp.com/send?text='));

  const parsed = new URL(url);
  const textParam = parsed.searchParams.get('text') || '';
  assert.ok(textParam.includes('https://gy2027.netlify.app/'));
  assert.equal(textParam.includes('ais-pre'), false);
});
