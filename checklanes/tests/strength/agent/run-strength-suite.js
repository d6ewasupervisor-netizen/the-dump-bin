import { Agent, CursorAgentError } from '@cursor/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPrompt, checklanesRoot, loadScenarios, playwrightMcpServers, resultsDir, } from './lib/scenario.js';
const USE_AGENTS = Boolean(process.env.CURSOR_API_KEY);
const SKIP_AGENTS = process.env.STRENGTH_SKIP_AGENTS === '1';
function runDeterministic(name, cmd, args) {
    const cwd = checklanesRoot();
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
    const output = (result.stdout || result.stderr || '').trim();
    return {
        ok: result.status === 0,
        detail: output.slice(0, 2000) || `exit ${result.status}`,
    };
}
async function runAgentScenario(scenario) {
    const needsPlaywright = scenario.id === '01-store-picker' || scenario.id === '02-hub-shell';
    const prompt = buildPrompt(scenario);
    try {
        const result = await Agent.prompt(prompt, {
            apiKey: process.env.CURSOR_API_KEY,
            model: { id: 'composer-2.5' },
            local: { cwd: checklanesRoot(), settingSources: [] },
            ...(needsPlaywright ? { mcpServers: playwrightMcpServers() } : {}),
        });
        if (result.status === 'error') {
            return { ok: false, detail: `agent run failed: ${result.id}` };
        }
        const reportPath = path.join(resultsDir(), `${scenario.id}-report.json`);
        if (fs.existsSync(reportPath)) {
            try {
                const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
                return { ok: Boolean(report.ok), detail: report.summary || 'see report file' };
            }
            catch {
                return { ok: false, detail: 'report file invalid JSON' };
            }
        }
        const text = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
        return { ok: true, detail: text.slice(0, 500) };
    }
    catch (err) {
        if (err instanceof CursorAgentError) {
            return { ok: false, detail: `startup failed: ${err.message}` };
        }
        throw err;
    }
}
async function main() {
    const results = [];
    console.log('=== Hub deterministic layers ===');
    for (const [name, cmd, args] of [
        ['hub-smoke', 'npm', ['run', 'strength:smoke']],
        ['api-load', 'npm', ['run', 'strength:load']],
    ]) {
        const r = runDeterministic(name, cmd, [...args]);
        results.push({ scenario: name, ok: r.ok, detail: r.detail });
        console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${name}`);
        if (!r.ok)
            console.log(r.detail.slice(0, 400));
    }
    if (!USE_AGENTS || SKIP_AGENTS) {
        console.log('\n=== Agent scenarios skipped (set CURSOR_API_KEY to enable) ===');
        for (const s of loadScenarios()) {
            results.push({ scenario: s.id, ok: true, detail: 'skipped', skipped: true });
        }
    }
    else {
        console.log('\n=== Agent scenarios ===');
        for (const scenario of loadScenarios()) {
            process.stdout.write(`Running ${scenario.id}... `);
            const r = await runAgentScenario(scenario);
            results.push({ scenario: scenario.id, ok: r.ok, detail: r.detail });
            console.log(r.ok ? 'PASS' : 'FAIL');
        }
    }
    const summaryPath = path.join(resultsDir(), 'suite-summary.json');
    const ok = results.filter((r) => !r.skipped).every((r) => r.ok);
    fs.writeFileSync(summaryPath, JSON.stringify({
        ok,
        target: 'hub',
        hubBase: process.env.STRENGTH_HUB_BASE_URL || 'https://the-dump-bin.com/checklanes',
        apiBase: process.env.STRENGTH_API_BASE_URL || 'https://eod-api.the-dump-bin.com',
        results,
    }, null, 2));
    console.log(`\nSummary written to ${summaryPath}`);
    console.log(ok ? 'STRENGTH SUITE: PASS' : 'STRENGTH SUITE: FAIL');
    return ok ? 0 : 1;
}
main().then((code) => process.exit(code), (err) => {
    console.error(err);
    process.exit(2);
});
