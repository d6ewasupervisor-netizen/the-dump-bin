/* Unique Fred Meyer store list for Visit confirm. Node-testable. */
(function (global) {
  'use strict';

  const FALLBACK_STORES = [5,11,13,17,18,19,21,23,24,25,28,30,31,35,40,41,49,50,53,60,63,70,71,75,90,93,111,122,125,126,127,135,140,143,150,153,156,158,163,165,171,180,185,186,195,196,198,208,209,210,214,215,218,220,224,225,226,227,236,240,242,253,255,260,265,281,285,286,325,328,351,355,360,372,375,377,383,390,391,393,417,424,439,449,457,458,459,460,462,464,482,485,486,516,600,603,604,605,608,613,614,615,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,665,667,668,681,682,683,685,688,691,694,999];

  function toStoreNum(value) {
    if (value && typeof value === 'object') {
      value = value.storeNum ?? value.store_num ?? value.storeNumber ?? value.id ?? value;
    }
    const n = Number(String(value ?? '').replace(/^0+(?=\d)/, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function uniqueStoreNumbers(...lists) {
    const nums = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const n = toStoreNum(item);
        if (n != null) nums.push(n);
      }
    }
    if (!nums.includes(999)) nums.push(999);
    return [...new Set(nums)].sort((a, b) => a - b);
  }

  function mergeStoreCatalog(...lists) {
    return uniqueStoreNumbers(FALLBACK_STORES, ...lists);
  }

  function pickerItemsForStores(stores, scheduled) {
    const ordered = uniqueStoreNumbers(stores, scheduled);
    return ordered.map((n) => ({ id: String(n), label: `Store ${n}` }));
  }

  const api = {
    FALLBACK_STORES,
    toStoreNum,
    uniqueStoreNumbers,
    mergeStoreCatalog,
    pickerItemsForStores,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.EodStoreCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
