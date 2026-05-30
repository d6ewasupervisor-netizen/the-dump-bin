/**
 * Shared URL targets for Checklanes assignment hub strength tests.
 * Frontend: GitHub Pages (the-dump-bin.com/checklanes)
 * Backend: eod-api on Railway
 * POG static assets: checklanes.the-dump-bin.com (Render)
 */
export const SITE_BASE = (process.env.STRENGTH_SITE_BASE_URL || 'https://the-dump-bin.com').replace(/\/$/, '');
export const HUB_BASE = (process.env.STRENGTH_HUB_BASE_URL || `${SITE_BASE}/checklanes`).replace(/\/$/, '');
export const API_BASE = (process.env.STRENGTH_API_BASE_URL || 'https://eod-api.the-dump-bin.com').replace(/\/$/, '');
export const POG_BASE = (process.env.STRENGTH_POG_BASE_URL || 'https://checklanes.the-dump-bin.com').replace(/\/$/, '');

export const TARGET = process.env.STRENGTH_TARGET || 'hub';
