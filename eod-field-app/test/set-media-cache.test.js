'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cache = require('../js/lib/set-media-cache');

describe('set-media cache helpers', () => {
  it('scopes Cache Storage by store + date', () => {
    assert.equal(cache.cacheNameForShift('028', '2026-08-30'), 'eod-set-media:28:2026-08-30');
    assert.equal(cache.cacheNameForShift(682, '2026-08-30T12:00:00'), 'eod-set-media:682:2026-08-30');
    assert.ok(cache.isSetMediaCacheName('eod-set-media'));
    assert.ok(cache.isSetMediaCacheName('eod-set-media:28:2026-08-30'));
    assert.equal(cache.isSetMediaCacheName('eod-field-3.3.26'), false);
  });

  it('only accepts eod-api /api/ URLs', () => {
    assert.ok(cache.isEodApiUrl('/api/field-set/planogram-image?productId=1'));
    assert.ok(cache.isEodApiUrl('https://eod-api.the-dump-bin.com/api/digital-signoffs/rows/1/photos/si/9/image?thumb=1'));
    assert.equal(cache.isEodApiUrl('https://d1.cloudfront.net/foo.jpg'), false);
    assert.equal(cache.isEodApiUrl('https://sas.example/image'), false);
    assert.equal(cache.absApiUrl('https://d1.cloudfront.net/foo.jpg'), '');
    assert.match(cache.absApiUrl('/api/field-set/planogram-image?p=1'), /^https:\/\/eod-api\.the-dump-bin\.com\/api\//);
  });

  it('skips background prefetch on saveData; thumbs-only on slow cellular', () => {
    const off = cache.connectionPrefetchPolicy({ saveData: true, effectiveType: '4g' });
    assert.equal(off.allowPrefetch, false);
    assert.equal(off.prefetchThumbs, false);
    assert.equal(off.prefetchPlanogramImages, false);

    const slow = cache.connectionPrefetchPolicy({ saveData: false, effectiveType: '3g' });
    assert.equal(slow.allowPrefetch, true);
    assert.equal(slow.prefetchThumbs, true);
    assert.equal(slow.prefetchPlanogramImages, false);

    const wifi = cache.connectionPrefetchPolicy({ saveData: false, effectiveType: '4g' });
    assert.equal(wifi.prefetchThumbs, true);
    assert.equal(wifi.prefetchPlanogramImages, true);
  });

  it('stops prefetch when photos are near the soft cap or cache would eat it', () => {
    assert.equal(cache.prefetchAllowedFromPressure({
      totalBytes: 34 * 1024 * 1024,
      cacheBytes: 0,
      softBytes: 40 * 1024 * 1024,
      soft: false,
      hard: false,
      originPressure: false,
    }), false);

    assert.equal(cache.prefetchAllowedFromPressure({
      totalBytes: 20 * 1024 * 1024,
      cacheBytes: 25 * 1024 * 1024,
      softBytes: 40 * 1024 * 1024,
      soft: false,
      hard: false,
      originPressure: false,
    }), false);

    assert.equal(cache.prefetchAllowedFromPressure({
      totalBytes: 8 * 1024 * 1024,
      cacheBytes: 2 * 1024 * 1024,
      softBytes: 40 * 1024 * 1024,
      soft: false,
      hard: false,
      originPressure: false,
    }), true);

    assert.equal(cache.prefetchAllowedFromPressure({
      totalBytes: 8 * 1024 * 1024,
      cacheBytes: 0,
      softBytes: 40 * 1024 * 1024,
      soft: false,
      hard: false,
      originPressure: true,
    }), false);
  });
});

describe('set-media wiring', () => {
  it('loads the cache helper before PhotoDB and prefetch', () => {
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    const cacheIdx = html.indexOf('js/lib/set-media-cache.js');
    const photosIdx = html.indexOf('js/features/photo-sessions.js');
    const prefetchIdx = html.indexOf('js/lib/set-media-prefetch.js');
    assert.ok(cacheIdx > 0 && cacheIdx < photosIdx && photosIdx < prefetchIdx);
  });

  it('photo-sessions nets Cache Storage out and yields it on quota', () => {
    const src = fs.readFileSync(path.join(__dirname, '../js/features/photo-sessions.js'), 'utf8');
    assert.match(src, /usageNetCache/);
    assert.match(src, /cacheBytes/);
    assert.match(src, /prefetchBlocked/);
    assert.match(src, /yieldSetMediaToPhotos/);
    assert.match(src, /bindShift/);
    assert.match(src, /NEAR_SOFT_FRAC = 0\.85/);
  });

  it('prefetch warms thumbs only and never CloudFront', () => {
    const prefetch = fs.readFileSync(path.join(__dirname, '../js/lib/set-media-prefetch.js'), 'utf8');
    const review = fs.readFileSync(path.join(__dirname, '../js/lib/set-review.js'), 'utf8');
    const pog = fs.readFileSync(path.join(__dirname, '../js/lib/si-planogram-board.js'), 'utf8');
    assert.match(prefetch, /thumbUrl/);
    assert.doesNotMatch(prefetch, /p\.thumbUrl \|\| p\.url/);
    assert.doesNotMatch(prefetch, /EodSiPlanogram/);
    assert.match(review, /absApiUrl/);
    assert.match(pog, /absApiUrl/);
    assert.match(pog, /boardMem\.delete/);
    assert.match(review, /EodSetMediaCache\?\.match/);
  });

  it('telemetry reports cache bytes separately from PhotoDB', () => {
    const api = fs.readFileSync(path.join(__dirname, '../js/api.js'), 'utf8');
    assert.match(api, /X-EOD-Cache-Bytes/);
    assert.match(api, /cacheBytes/);
  });
});
