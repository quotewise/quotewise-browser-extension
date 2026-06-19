import fs from 'fs';

describe('private-mode service-worker gating', () => {
  const source = fs.readFileSync(
    require.resolve('../../src/background/service-worker'),
    'utf8',
  );

  it('threads synced settings into icon resolution and automatic gates', () => {
    expect(source).toContain("import { getSettings, onSettingsChanged } from '../settings/settings-store'");
    expect(source).toContain('currentSettings = await getSettings()');
    expect(source).toContain('onSettingsChanged');
    expect(source).toContain('resolveIconPresentation(authState, resolvedDuplicateResult');
    expect(source).toContain('isPrivateModeEnabled()');
  });

  it('gates every automatic capture/preflight entry point while keeping CHECK_NOW explicit', () => {
    const extractionIndex = source.indexOf('async function requestTweetDataExtraction');
    const preflightIndex = source.indexOf('async function runAutomaticPreflightForExtractedTweet');
    const statusIndex = source.indexOf('async function checkQuoteCollectionStatus');
    const probeIndex = source.indexOf('function scheduleAutomaticOriginatorProbe');
    const checkNowIndex = source.indexOf('async function handleCheckNow');

    expect(source.slice(extractionIndex, extractionIndex + 900)).toContain('reason: \'private_mode\'');
    expect(source.slice(preflightIndex, preflightIndex + 900)).toContain('reason: \'private_mode\'');
    expect(source.slice(statusIndex, statusIndex + 1200)).toContain('reason: \'private_mode\'');
    expect(source.slice(probeIndex, probeIndex + 900)).toContain('reason: \'private_mode\'');
    expect(source.slice(checkNowIndex, checkNowIndex + 1800)).toContain('MessageType.PREFLIGHT_CHECK');
  });

  it('keeps private mode enabled when CHECK_NOW runs', () => {
    const checkNowIndex = source.indexOf('async function handleCheckNow');
    const checkNowBlock = source.slice(checkNowIndex, source.indexOf('/**\n * Check if a quote exists', checkNowIndex));

    expect(checkNowBlock).not.toContain('updateSettings');
    expect(checkNowBlock).not.toContain('privateMode: false');
  });
});
