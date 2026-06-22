import { StorageCleanupService } from '../../src/background/storage-cleanup';

// The alarm name is an implementation detail asserted by literal here so the
// test stays decoupled from the export and fails on behavior, not compilation.
const STORAGE_CLEANUP_ALARM = 'storage-cleanup';

describe('StorageCleanupService periodic scheduling (MV3 alarms)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chrome.storage.local.get as jest.Mock).mockResolvedValue({});
    (chrome.alarms.get as jest.Mock).mockResolvedValue(undefined);
  });

  it('schedules recurring cleanup via chrome.alarms, never setInterval', async () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const service = new StorageCleanupService();

    await service.startPeriodicCleanup(true);

    // Default cleanupInterval is 6h → 360 minutes.
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      STORAGE_CLEANUP_ALARM,
      { periodInMinutes: 360 },
    );
    expect(setIntervalSpy).not.toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });

  it('does not reset the schedule when the alarm already exists', async () => {
    (chrome.alarms.get as jest.Mock).mockResolvedValue({
      name: STORAGE_CLEANUP_ALARM,
      periodInMinutes: 360,
    });
    const service = new StorageCleanupService();

    await service.startPeriodicCleanup(true);

    expect(chrome.alarms.get).toHaveBeenCalledWith(STORAGE_CLEANUP_ALARM);
    expect(chrome.alarms.create).not.toHaveBeenCalled();
  });

  it('clears the alarm when periodic cleanup is stopped', () => {
    const service = new StorageCleanupService();

    service.stopPeriodicCleanup();

    expect(chrome.alarms.clear).toHaveBeenCalledWith(STORAGE_CLEANUP_ALARM);
  });

  it('still runs an immediate cleanup pass on start', async () => {
    const service = new StorageCleanupService();

    await service.startPeriodicCleanup(true);

    expect(chrome.storage.local.get).toHaveBeenCalled();
  });
});
