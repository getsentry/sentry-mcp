import type { Event } from "../api-client/types";
import type { z } from "zod";
import type {
  FrameInterface,
  ExceptionInterface,
  ThreadEntrySchema,
} from "../api-client/schema";

// Type aliases for cleaner code
type Frame = z.infer<typeof FrameInterface>;
type ExceptionValue = z.infer<typeof ExceptionInterface>;
type Thread = z.infer<typeof ThreadEntrySchema>;
type StackTrace = { frames: Frame[] };

/**
 * Test fixture factories for creating Event objects with minimal boilerplate.
 * These factories provide sensible defaults while allowing customization.
 */

// Frame factory with common defaults
export function createFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    filename: "/app/main.js",
    function: "main",
    lineNo: 42,
    ...overrides,
  };
}

// Platform-specific frame factories
export const frameFactories = {
  python: (overrides: Partial<Frame> = {}) =>
    createFrame({
      filename: "/app/main.py",
      function: "process_data",
      ...overrides,
    }),

  java: (overrides: Partial<Frame> = {}) =>
    createFrame({
      filename: "Example.java",
      module: "com.example.Example",
      function: "doSomething",
      ...overrides,
    }),

  javascript: (overrides: Partial<Frame> = {}) =>
    createFrame({
      filename: "/app/main.js",
      function: "handleRequest",
      colNo: 15,
      ...overrides,
    }),

  ruby: (overrides: Partial<Frame> = {}) =>
    createFrame({
      filename: "/app/main.rb",
      function: "process",
      ...overrides,
    }),

  php: (overrides: Partial<Frame> = {}) =>
    createFrame({
      filename: "/app/main.php",
      function: "handleRequest",
      ...overrides,
    }),
};

// StackTrace factory
export function createStackTrace(frames: Frame[]): StackTrace {
  return { frames };
}

// Exception value factory
export function createExceptionValue(
  overrides: Partial<ExceptionValue> = {},
): ExceptionValue {
  return {
    type: "Error",
    value: "Something went wrong",
    stacktrace: createStackTrace([createFrame()]),
    ...overrides,
  };
}

// Thread factory
export function createThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 1,
    name: "main",
    crashed: true,
    stacktrace: createStackTrace([createFrame()]),
    ...overrides,
  };
}

// Event factory with builder pattern
export class EventBuilder {
  private event: Event;

  constructor(platform = "javascript") {
    this.event = {
      id: "test123",
      title: "Test Event",
      message: null,
      platform,
      type: "error",
      entries: [],
      contexts: {},
    } as Event;
  }

  withId(id: string): this {
    this.event.id = id;
    return this;
  }

  withPlatform(platform: string): this {
    this.event.platform = platform;
    return this;
  }

  withException(exception: ExceptionValue): this {
    this.event.entries.push({
      type: "exception",
      data: {
        values: [exception],
      },
    });
    return this;
  }

  withChainedExceptions(exceptions: ExceptionValue[]): this {
    this.event.entries.push({
      type: "exception",
      data: {
        values: exceptions,
      },
    });
    return this;
  }

  withThread(thread: Thread): this {
    const existingThread = this.event.entries.find((e) => e.type === "threads");
    if (
      existingThread?.data &&
      typeof existingThread.data === "object" &&
      "values" in existingThread.data
    ) {
      (existingThread.data as any).values.push(thread);
    } else {
      this.event.entries.push({
        type: "threads",
        data: {
          values: [thread],
        },
      });
    }
    return this;
  }

  withMessage(message: string): this {
    this.event.entries.push({
      type: "message",
      data: {
        formatted: message,
      },
    });
    return this;
  }

  withTitle(title: string): this {
    this.event.title = title;
    return this;
  }

  withType(type: string): this {
    this.event.type = type;
    return this;
  }

  withContexts(contexts: Record<string, any>): this {
    this.event.contexts = contexts;
    return this;
  }

  build(): Event {
    return { ...this.event };
  }
}

// Convenience factories for common test scenarios
export const testEvents = {
  // Simple Python exception
  pythonException: (errorMessage = "Invalid value") =>
    new EventBuilder("python")
      .withException(
        createExceptionValue({
          type: "ValueError",
          value: errorMessage,
          stacktrace: createStackTrace([
            frameFactories.python({ lineNo: 42 }),
            frameFactories.python({
              filename: "/app/utils.py",
              function: "validate",
              lineNo: 15,
            }),
          ]),
        }),
      )
      .build(),

  // Java thread error
  javaThreadError: (message = "Test error") =>
    new EventBuilder("java")
      .withTitle("Test Error")
      .withType("error")
      .withMessage(message)
      .withThread(
        createThread({
          id: 187,
          name: "CONTRACT_WORKER",
          state: "RUNNABLE",
          stacktrace: createStackTrace([
            frameFactories.java({
              filename: "Thread.java",
              module: "java.lang.Thread",
              function: "run",
              lineNo: 833,
            }),
            frameFactories.java({
              filename: "AeronServer.java",
              module: "com.citics.eqd.mq.aeron.AeronServer",
              function: "lambda$start$3",
              lineNo: 110,
            }),
          ]),
        }),
      )
      .build(),

  // Enhanced frame with context and variables
  enhancedFrame: (platform = "python") => {
    const frame = frameFactories[platform as keyof typeof frameFactories]({
      inApp: true,
      context: [
        [40, '    raise ValueError("User not found")'],
        [41, "    "],
        [42, "    balance = user.account.balance"],
        [43, "    if balance < amount:"],
        [44, "        raise InsufficientFundsError()"],
      ],
      vars: {
        amount: 150.0,
        user_id: "usr_123456",
        user: null,
      },
    });

    return new EventBuilder(platform)
      .withException(
        createExceptionValue({
          type: "ValueError",
          value: "Something went wrong",
          stacktrace: createStackTrace([frame]),
        }),
      )
      .build();
  },
};

// Helper to create frames with context lines
export function createFrameWithContext(
  frame: Partial<Frame>,
  contextLines: Array<[number, string]>,
  vars?: Record<string, any>,
): Frame {
  return createFrame({
    ...frame,
    inApp: true,
    context: contextLines,
    vars,
  });
}

// Advanced test fixtures for specific scenarios
export const advancedFixtures = {
  // Create a minimal event with just an error message
  minimalError: (message: string, platform = "javascript") =>
    new EventBuilder(platform)
      .withException(createExceptionValue({ value: message }))
      .build(),

  // Create an event with multiple exceptions (chained errors)
  chainedExceptions: (platform = "javascript") =>
    new EventBuilder(platform)
      .withException(
        createExceptionValue({
          type: "Error",
          value: "High level error",
          stacktrace: createStackTrace([createFrame({ lineNo: 100 })]),
        }),
      )
      .withException(
        createExceptionValue({
          type: "CausedBy",
          value: "Low level error",
          stacktrace: createStackTrace([createFrame({ lineNo: 50 })]),
        }),
      )
      .build(),

  // Create event with specific context data
  withContextData: (contexts: Record<string, any>) => {
    return new EventBuilder().withContexts(contexts).build();
  },
};
