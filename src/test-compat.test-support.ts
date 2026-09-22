import { onTestFinished, vi, test as vitestTest } from 'vitest';

interface TestContext {
  after(callback: () => unknown): void;
  test(name: string, body: (context: TestContext) => unknown): Promise<void>;
  mock: {
    method(object: object, name: string, implementation: (...args: never[]) => unknown): void;
    restoreAll(): void;
    timers: {
      enable(options: { apis: string[]; now: number }): void;
      tick(milliseconds: number): void;
    };
  };
}

/** Keep the existing Node test boundary while running each case under Vitest. */
export function test(name: string, body: (context: TestContext) => unknown): void {
  vitestTest(name, async () => {
    onTestFinished(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });
    const context: TestContext = {
      after: (callback) => onTestFinished(callback),
      test: async (_name, nested) => {
        await nested(context);
      },
      mock: {
        method: (object, key, implementation) => {
          vi.spyOn(object as never, key as never).mockImplementation(implementation as never);
        },
        restoreAll: () => vi.restoreAllMocks(),
        timers: {
          enable: ({ apis, now }) => {
            vi.useFakeTimers({ toFake: apis as never });
            vi.setSystemTime(now);
          },
          tick: (milliseconds) => vi.advanceTimersByTime(milliseconds),
        },
      },
    };
    await body(context);
  });
}
