/* SAS PROD schedule admin URL. /en/field/schedules/{visitId}/schedule/admin */
(function (global) {
  'use strict';

  function visitIdFrom(raw) {
    const id = String(raw == null ? '' : raw).replace(/\D/g, '');
    return /^\d{5,12}$/.test(id) ? id : '';
  }

  function visitIdForRow(row, selectedVisitId) {
    return visitIdFrom(row && row.live && row.live.prodVisitId)
      || visitIdFrom(row && row.visitId)
      || visitIdFrom(selectedVisitId);
  }

  function categoryAdminUrl(visitId) {
    const id = visitIdFrom(visitId);
    if (!id) return '';
    return 'https://prod.sasretail.com/en/field/schedules/' + id + '/schedule/admin';
  }

  const api = {
    visitIdFrom,
    visitIdForRow,
    categoryAdminUrl,
    HOLD_MS: 650,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  global.SasCategoryAdmin = api;
})(typeof window !== 'undefined' ? window : globalThis);
