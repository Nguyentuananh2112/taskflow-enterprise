// Fake/spy dùng chung cho test U/A/I của mọi module (test-spec-*.md §0).
export { testEnvVars, productionEnvVars, testValkeyUrl, integrationRequired } from './env';
export { FakeUnitOfWork, type Snapshottable, type UowStep } from './fake-unit-of-work';
export {
  SpyEventBus,
  SpyLogger,
  createSpy,
  createSpyRealtimeNotifier,
  type LogEntry,
  type SpyCall,
} from './spies';
export { FakeClock, FakeRandom, SequentialIdGenerator } from './time-and-ids';
export { envelopeOf, errorOf, type EnvelopeBody } from './http';
