import { MemoryJobQueue } from '../../src/substrate/memory-job-queue.js';
import { describeJobQueueContract } from './job-queue-contract.js';

describeJobQueueContract('memory', async () => {
  let now = 0;
  const q = new MemoryJobQueue({ now: () => now });
  return {
    queue: q,
    link: q,
    setNow: (ms) => {
      now = ms;
    },
    close: async () => {},
  };
});
