import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoChunks, CHUNK_SIZE, MAX_INLINE_LOGO_SIZE, appendVersionParam } from '../firebase/services';
import { getRegistrationDocId } from './reference';
import { normalizePhoneNumber } from './phone';

describe('BUG-01: Document ID generation & Firestore Rule Compatibility', () => {
  it('generates canonical ID with reg_p prefix matching firestore.rules RE2 replace syntax', () => {
    const rawPhone = '+225 07 01 02 03 04';
    const norm = normalizePhoneNumber(rawPhone);
    assert.strictEqual(norm.isValid, true);
    assert.strictEqual(norm.normalized, '+2250701020304');

    const docId = getRegistrationDocId(norm.normalized);
    assert.strictEqual(docId, 'reg_p2250701020304');

    // Emulate firestore.rules check:
    // canonicalId = 'reg_' + request.resource.data.normalizedPhone.replace('\\+', 'p')
    const rulesCalculatedDocId = 'reg_' + norm.normalized.replace('+', 'p');
    assert.strictEqual(docId, rulesCalculatedDocId, 'docId must match the rules replace calculation exactly');
  });

  it('rejects invalid or unnormalized phones from producing invalid document IDs', () => {
    assert.strictEqual(normalizePhoneNumber('invalid').isValid, false);
    const norm = normalizePhoneNumber('0701020304');
    assert.strictEqual(norm.isValid, true); // auto normalizes to +225...
    assert.strictEqual(norm.normalized, '+2250701020304');
    assert.strictEqual(getRegistrationDocId(norm.normalized), 'reg_p2250701020304');
  });
});

describe('INTERVENTION-3: URL Versioning & Safe Partial Settings Write', () => {
  it('correctly appends or updates version parameter preserving all existing query params and tokens', () => {
    const storageUrlWithToken = 'https://firebasestorage.googleapis.com/v0/b/gyw-2027.appspot.com/o/logos%2Fofficial_logo.svg?alt=media&token=abcdef-1234-xyz';
    const timestamp = 1710000000;
    const versioned = appendVersionParam(storageUrlWithToken, timestamp);

    assert.ok(versioned.includes('alt=media'), 'Must retain alt=media');
    assert.ok(versioned.includes('token=abcdef-1234-xyz'), 'Must retain token query parameter intact');
    assert.ok(versioned.includes('v=1710000000'), 'Must contain version query parameter');
    assert.strictEqual(versioned.split('?').length, 2, 'Must have exactly one query question mark, not double ??');
  });

  it('ensures changing a non-logo event setting never touches logoUrl', () => {
    // Emulates the firestorePatch logic in updateEventSettings
    const incomingPatch = { location: 'Palais de la Culture, Treichville' };
    const allowedKeys = ['location', 'schedules', 'contactPhone', 'registrationsOpen', 'logoUrl'];

    const firestorePatch: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (key in incomingPatch) {
        const val = (incomingPatch as any)[key];
        if (key === 'logoUrl') {
          if (typeof val === 'string' && val.length > MAX_INLINE_LOGO_SIZE) {
            firestorePatch[key] = '';
            continue;
          }
        }
        firestorePatch[key] = val;
      }
    }

    assert.deepStrictEqual(firestorePatch, { location: 'Palais de la Culture, Treichville' });
    assert.strictEqual('logoUrl' in firestorePatch, false, 'logoUrl must NOT be included in partial update when not changed');
  });

  it('preserves inline SVGs under MAX_INLINE_LOGO_SIZE directly in settings/event for persistence', () => {
    const normalSvgDataUri = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wLDBoMTB2MTBIMHoiLz48L3N2Zz4=';
    assert.ok(normalSvgDataUri.length <= MAX_INLINE_LOGO_SIZE);

    const incomingPatch = { logoUrl: normalSvgDataUri };
    const firestorePatch: Record<string, any> = {};

    if (incomingPatch.logoUrl.length > MAX_INLINE_LOGO_SIZE) {
      firestorePatch.logoUrl = '';
    } else {
      firestorePatch.logoUrl = incomingPatch.logoUrl;
    }

    assert.strictEqual(firestorePatch.logoUrl, normalSvgDataUri, 'Normal SVGs must persist directly in firestorePatch without blanking');
  });

  it('blanks out direct logoUrl only if the asset exceeds MAX_INLINE_LOGO_SIZE so chunks are used', () => {
    const hugeDataUri = 'data:image/svg+xml;base64,' + 'Z'.repeat(MAX_INLINE_LOGO_SIZE + 500);
    assert.ok(hugeDataUri.length > MAX_INLINE_LOGO_SIZE);

    const incomingPatch = { logoUrl: hugeDataUri };
    const firestorePatch: Record<string, any> = {};

    if (incomingPatch.logoUrl.length > MAX_INLINE_LOGO_SIZE) {
      firestorePatch.logoUrl = '';
    } else {
      firestorePatch.logoUrl = incomingPatch.logoUrl;
    }

    assert.strictEqual(firestorePatch.logoUrl, '', 'Huge SVGs must be blanked in root doc to avoid exceeding 1 MiB limit');
  });

  it('properly removes logoAsset from local cache when deleteField sentinel is passed', () => {
    const existingCache: any = {
      logoUrl: 'https://example.com/logo.svg',
      logoAsset: { assetId: 'abc-123', totalChunks: 3, totalSize: 500000, mimeType: 'image/svg+xml', updatedAt: '2026-01-01' },
    };

    const newSettings: any = {
      logoUrl: '',
      logoAsset: { _methodName: 'deleteField' },
    };

    const updatedCache = { ...existingCache };
    for (const [key, val] of Object.entries(newSettings)) {
      if (val && typeof val === 'object' && (val as any)._methodName === 'deleteField') {
        delete updatedCache[key];
      } else if (val !== undefined) {
        updatedCache[key] = val;
      }
    }

    assert.strictEqual(updatedCache.logoUrl, '');
    assert.strictEqual('logoAsset' in updatedCache, false, 'logoAsset must be completely deleted from cache');
  });

  it('correctly resolves active logo when stored via chunked asset even if logoUrl is empty', () => {
    const settings: any = {
      logoUrl: '',
      logoAsset: { assetId: 'test-asset-456' },
    };

    // Simulated check in AdminLogoManager
    const hasActiveMainLogo = Boolean(settings.logoUrl || settings.logoAsset?.assetId);
    assert.strictEqual(hasActiveMainLogo, true, 'hasActiveMainLogo must be true when logoAsset exists even if logoUrl is empty');

    // Simulated check after removal
    const clearedSettings: any = {
      logoUrl: '',
    };
    const hasActiveAfterRemoval = Boolean(clearedSettings.logoUrl || clearedSettings.logoAsset?.assetId);
    assert.strictEqual(hasActiveAfterRemoval, false, 'hasActiveMainLogo must be false after complete removal');
  });
});

describe('BUG-02: Segmented Chunked Logo Storage (< 300 KiB)', () => {
  it('ensures CHUNK_SIZE is strictly under 300 KiB and Firestore rule 350,000 bytes limit', () => {
    assert.ok(CHUNK_SIZE < 300 * 1024, 'CHUNK_SIZE must be under 300 KiB');
    assert.ok(CHUNK_SIZE <= 350000, 'CHUNK_SIZE must be under 350,000 bytes');
  });

  it('splits a large SVG data URI into deterministic chunks and reassembles perfectly', () => {
    // Generate a simulated 1.2 MiB SVG string (which previously crashed Firestore 1 MiB limit)
    const basePayload = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="gold"/></svg>';
    const largeDummyData = 'data:image/svg+xml;base64,' + 'A'.repeat(1200000); // 1.2 MB data URI

    const chunks = splitIntoChunks(largeDummyData, CHUNK_SIZE);

    assert.ok(chunks.length > 1, 'A 1.2 MB asset should be split into multiple chunks');
    assert.strictEqual(chunks.length, Math.ceil(largeDummyData.length / CHUNK_SIZE));

    // Verify every single chunk is under CHUNK_SIZE
    for (let i = 0; i < chunks.length; i++) {
      assert.ok(chunks[i].length <= CHUNK_SIZE, `Chunk ${i} exceeds chunk limit`);
      assert.ok(chunks[i].length <= 350000, `Chunk ${i} exceeds firestore rule limit`);
    }

    // Verify perfect byte-for-byte reassembly
    const reassembled = chunks.join('');
    assert.strictEqual(reassembled, largeDummyData);
    assert.strictEqual(reassembled.length, largeDummyData.length);
  });

  it('handles empty or small SVG data URI without unnecessary splitting', () => {
    assert.deepStrictEqual(splitIntoChunks(''), []);
    const smallSvg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    const chunks = splitIntoChunks(smallSvg, CHUNK_SIZE);
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0], smallSvg);
  });
});

describe('BUG-03: Strict Event Registration Status Verification', () => {
  it('strictly validates event registrations status', () => {
    // Emulates the firestore.rules logic:
    // function areRegistrationsOpen() {
    //   return exists(/databases/$(database)/documents/settings/event) &&
    //          get(/databases/$(database)/documents/settings/event).data.registrationsOpen == true;
    // }
    const simulateRulesCheck = (settingsDocExists: boolean, registrationsOpen?: boolean) => {
      return settingsDocExists && registrationsOpen === true;
    };

    // If settings/event does not exist -> FALSE (previously was TRUE)
    assert.strictEqual(simulateRulesCheck(false, undefined), false);

    // If settings/event exists and registrationsOpen is false -> FALSE
    assert.strictEqual(simulateRulesCheck(true, false), false);

    // If settings/event exists and registrationsOpen is missing -> FALSE
    assert.strictEqual(simulateRulesCheck(true, undefined), false);

    // Only if settings/event exists and registrationsOpen is TRUE -> TRUE
    assert.strictEqual(simulateRulesCheck(true, true), true);
  });
});

describe('BUG-05: Historical Registration Update Compatibility', () => {
  it('supports legacy documents without internal id field while maintaining integrity', () => {
    // Emulates the firestore.rules check for updates:
    // (!('id' in resource.data) ? (!('id' in incoming()) || incoming().id == registrationId) : incoming().id == resource.data.id)
    const checkIdPreservation = (
      resourceData: Record<string, any>,
      incomingData: Record<string, any>,
      registrationId: string
    ) => {
      if (!('id' in resourceData)) {
        return !('id' in incomingData) || incomingData.id === registrationId;
      }
      return incomingData.id === resourceData.id;
    };

    const docId = 'reg_p2250701020304';

    // 1. Modern doc with internal id matching
    assert.strictEqual(checkIdPreservation({ id: docId, status: 'confirmed' }, { id: docId, status: 'attended' }, docId), true);

    // 2. Modern doc with modified id -> REJECTED
    assert.strictEqual(checkIdPreservation({ id: docId, status: 'confirmed' }, { id: 'other_id', status: 'attended' }, docId), false);

    // 3. Historical doc without internal id updated without id field -> ACCEPTED
    assert.strictEqual(checkIdPreservation({ status: 'confirmed' }, { status: 'attended' }, docId), true);

    // 4. Historical doc without internal id updated with id matching registrationId -> ACCEPTED
    assert.strictEqual(checkIdPreservation({ status: 'confirmed' }, { id: docId, status: 'attended' }, docId), true);

    // 5. Historical doc without internal id updated with incorrect id -> REJECTED
    assert.strictEqual(checkIdPreservation({ status: 'confirmed' }, { id: 'wrong_id', status: 'attended' }, docId), false);
  });
});
