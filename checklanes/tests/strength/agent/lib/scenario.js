import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function repoRoot() {
    return path.join(__dirname, '..', '..', '..', '..', '..');
}
export function checklanesRoot() {
    return path.join(repoRoot(), 'checklanes');
}
export function scenariosDir() {
    return path.join(__dirname, '..', '..', 'scenarios');
}
export function resultsDir() {
    const dir = path.join(__dirname, '..', '..', 'results');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
export function loadScenarios() {
    const dir = scenariosDir();
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => ({
        id: path.basename(f, '.md'),
        filePath: path.join(dir, f),
        content: fs.readFileSync(path.join(dir, f), 'utf8'),
    }));
}
export function buildPrompt(scenario) {
    const hubBase = process.env.STRENGTH_HUB_BASE_URL || 'https://the-dump-bin.com/checklanes';
    const apiBase = process.env.STRENGTH_API_BASE_URL || 'https://eod-api.the-dump-bin.com';
    const pogBase = process.env.STRENGTH_POG_BASE_URL || 'https://checklanes.the-dump-bin.com';
    const root = repoRoot();
    return `You are running Checklanes assignment hub strength test scenario "${scenario.id}".

Repository root: ${root}
STRENGTH_HUB_BASE_URL: ${hubBase}
STRENGTH_API_BASE_URL: ${apiBase}
STRENGTH_POG_BASE_URL: ${pogBase}

Run npm scripts from the checklanes/ directory (npm run strength:smoke, etc.).

Follow the scenario below exactly. When finished, write a JSON report to checklanes/tests/strength/results/${scenario.id}-report.json with:
{ "scenario": "${scenario.id}", "ok": boolean, "summary": string, "checks": [{ "name": string, "pass": boolean, "detail": string }] }

---
${scenario.content}
`;
}
export function playwrightMcpServers() {
    return {
        playwright: {
            command: 'npx',
            args: ['-y', '@playwright/mcp@latest'],
        },
    };
}
