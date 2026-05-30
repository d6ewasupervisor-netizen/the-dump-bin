#!/usr/bin/env node
/**
 * Concurrent load against eod-api /api/hub/stores (expects 401 without auth).
 * Validates Railway backend handles concurrent requests without 5xx errors.
 */
import { performance } from 'node:perf_hooks';
import { API_BASE, SITE_BASE } from '../config.mjs';

const URL = `${API_BASE}/api/hub/stores`;
const CONNECTIONS = Number(process.env.STRENGTH_LOAD_CONNECTIONS || 30);
const DURATION_SEC = Number(process.env.STRENGTH_LOAD_DURATION_SEC || 15);
const P99_MAX_MS = Number(process.env.STRENGTH_LOAD_P99_MAX_MS || 3000);
const MAX_ERRORS = Number(process.env.STRENGTH_LOAD_MAX_ERRORS || 10);

/** @type {number[]} */
const latencies = [];
let errors = 0;
let total = 0;
let stop = false;

async function worker() {
  while (!stop) {
    const start = performance.now();
    try {
      const res = await fetch(URL, { headers: { Origin: SITE_BASE } });
      latencies.push(performance.now() - start);
      total += 1;
      if (res.status >= 500) errors += 1;
    } catch {
      errors += 1;
      total += 1;
      latencies.push(DURATION_SEC * 1000);
    }
  }
}

const workers = Array.from({ length: CONNECTIONS }, () => worker());
await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000));
stop = true;
await Promise.allSettled(workers);

latencies.sort((a, b) => a - b);
const p99Index = Math.max(0, Math.ceil(latencies.length * 0.99) - 1);
const p99 = latencies.length ? latencies[p99Index] : 0;
const p50 = latencies.length ? latencies[Math.floor(latencies.length * 0.5)] : 0;

const ok = errors <= MAX_ERRORS && p99 <= P99_MAX_MS && total > 0;
console.log(
  JSON.stringify(
    {
      ok,
      target: 'hub-api',
      url: URL,
      connections: CONNECTIONS,
      durationSec: DURATION_SEC,
      total,
      errors,
      maxErrors: MAX_ERRORS,
      p50Ms: Math.round(p50),
      p99Ms: Math.round(p99),
      p99MaxMs: P99_MAX_MS,
      note: '401/403 responses are expected; only 5xx counts as error',
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
