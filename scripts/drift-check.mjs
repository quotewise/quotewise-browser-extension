import { appendFile } from 'node:fs/promises';
import { chromium, errors } from 'playwright';
import { TWITTER_DOM_SELECTORS } from '../src/platforms/twitter/selectors.ts';
import { inspectTwitterDom } from './drift-check-dom.ts';

const TIMEOUT_MS = 30_000;

// Canonical public targets for the scheduled DOM contract check.
export const DRIFT_TARGETS = [
  { kind: 'status', url: 'https://x.com/jack/status/20' },
  { kind: 'article', url: 'https://x.com/Kpaxs/status/2015113747107398020' },
];

async function checkTarget(browser, target) {
  const page = await browser.newPage({ locale: 'en-US' });
  page.setDefaultTimeout(TIMEOUT_MS);

  try {
    let response;
    try {
      response = await page.goto(target.url, {
        waitUntil: 'domcontentloaded',
        timeout: TIMEOUT_MS,
      });
    } catch (error) {
      return { ...target, status: 'inconclusive', detail: `navigation failed: ${error.message}` };
    }

    if (!response || !response.ok()) {
      return {
        ...target,
        status: 'inconclusive',
        detail: `HTTP ${response?.status() ?? 'response unavailable'}`,
      };
    }

    try {
      await page.locator('article').first().waitFor({ state: 'attached', timeout: TIMEOUT_MS });
    } catch (error) {
      const detail = error instanceof errors.TimeoutError ? 'article render timed out' : error.message;
      return { ...target, status: 'inconclusive', detail };
    }

    const inspection = await page.evaluate(
      inspectTwitterDom,
      { selectors: TWITTER_DOM_SELECTORS, kind: target.kind },
    );

    if (inspection.renderer === 'public') {
      return {
        ...target,
        status: 'inconclusive',
        detail: 'X served its logged-out semantic renderer; signed-in extension DOM was not observable',
      };
    }

    return inspection.missing.length === 0
      ? { ...target, status: 'pass', detail: 'required selectors matched' }
      : { ...target, status: 'drift', detail: `missing: ${inspection.missing.join(', ')}` };
  } catch (error) {
    return { ...target, status: 'inconclusive', detail: `check failed: ${error.message}` };
  } finally {
    await page.close();
  }
}

function summarize(results) {
  const classification = results.some(result => result.status === 'drift')
    ? 'drift'
    : results.some(result => result.status === 'inconclusive') ? 'inconclusive' : 'pass';
  const report = results
    .map(result => `- **${result.status}** ${result.kind}: ${result.url} — ${result.detail}`)
    .join('\n');
  return { classification, report };
}

async function setGitHubOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const marker = `EOF_${name}_${Date.now()}`;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}<<${marker}\n${value}\n${marker}\n`);
}

async function main() {
  let results;
  if (process.env.DRIFT_MODE === 'simulate-drift' || process.argv.includes('--simulate-drift')) {
    results = [{
      ...DRIFT_TARGETS[0],
      status: 'drift',
      detail: 'simulated missing selector',
    }];
  } else {
    const browser = await chromium.launch({ headless: true });
    try {
      results = [];
      for (const target of DRIFT_TARGETS) results.push(await checkTarget(browser, target));
    } finally {
      await browser.close();
    }
  }

  const summary = summarize(results);
  console.log(JSON.stringify({ ...summary, results }, null, 2));
  await setGitHubOutput('classification', summary.classification);
  await setGitHubOutput('report', summary.report);
  if (summary.classification === 'drift') process.exitCode = 1;
}

await main();
