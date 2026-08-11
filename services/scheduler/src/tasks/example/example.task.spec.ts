import { prisma } from '@iecp/database';

import { ExampleTask } from './example.task';

jest.mock('@iecp/database', () => ({
  prisma: { user: { count: jest.fn() } },
}));

describe('ExampleTask', () => {
  it('logs the current user count without throwing', async () => {
    const countMock = prisma.user.count as jest.Mock;
    countMock.mockResolvedValueOnce(3);

    const task = new ExampleTask();

    await expect(task.logUserCount()).resolves.toBeUndefined();
    expect(countMock).toHaveBeenCalledTimes(1);
  });
});
