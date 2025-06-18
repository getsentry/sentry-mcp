import { describe, it, expect } from "vitest";
import { formatEventOutput, formatFrameHeader } from "./formatting";
import type { Event } from "../api-client/types";

describe("formatFrameHeader", () => {
  it("uses platform as fallback when language detection fails", () => {
    // Frame with no clear language indicators
    const unknownFrame = {
      filename: "/path/to/file.unknown",
      function: "someFunction",
      lineNo: 42,
    };

    // Without platform - should use generic format
    expect(formatFrameHeader(unknownFrame)).toBe(
      "    at someFunction (/path/to/file.unknown:42)",
    );

    // With platform python - should use Python format
    expect(formatFrameHeader(unknownFrame, undefined, "python")).toBe(
      '  File "/path/to/file.unknown", line 42, in someFunction',
    );

    // With platform java - should use Java format
    expect(formatFrameHeader(unknownFrame, undefined, "java")).toBe(
      "at UnknownClass.someFunction(/path/to/file.unknown:42)",
    );
  });
  it("formats Java stack traces correctly", () => {
    // With module and filename
    const javaFrame1 = {
      module: "com.example.ClassName",
      function: "methodName",
      filename: "ClassName.java",
      lineNo: 123,
    };
    expect(formatFrameHeader(javaFrame1)).toBe(
      "at com.example.ClassName.methodName(ClassName.java:123)",
    );

    // Without filename (common in Java) - needs platform hint
    const javaFrame2 = {
      module: "com.example.ClassName",
      function: "methodName",
      lineNo: 123,
    };
    expect(formatFrameHeader(javaFrame2, undefined, "java")).toBe(
      "at com.example.ClassName.methodName(Unknown Source:123)",
    );
  });

  it("formats Python stack traces correctly", () => {
    const pythonFrame = {
      filename: "/path/to/file.py",
      function: "function_name",
      lineNo: 42,
    };
    expect(formatFrameHeader(pythonFrame)).toBe(
      '  File "/path/to/file.py", line 42, in function_name',
    );

    // Module only (no filename) - needs platform hint
    const pythonModuleFrame = {
      module: "mymodule",
      function: "function_name",
      lineNo: 42,
    };
    expect(formatFrameHeader(pythonModuleFrame, undefined, "python")).toBe(
      '  File "mymodule", line 42, in function_name',
    );
  });

  it("formats JavaScript stack traces correctly", () => {
    // With column number
    const jsFrame1 = {
      filename: "/path/to/file.js",
      function: "functionName",
      lineNo: 10,
      colNo: 15,
    };
    expect(formatFrameHeader(jsFrame1)).toBe(
      "/path/to/file.js:10:15 (functionName)",
    );

    // Without column number but .js extension
    const jsFrame2 = {
      filename: "/path/to/file.js",
      function: "functionName",
      lineNo: 10,
    };
    expect(formatFrameHeader(jsFrame2)).toBe(
      "/path/to/file.js:10 (functionName)",
    );

    // Anonymous function (no function name)
    const jsFrame3 = {
      filename: "/path/to/file.js",
      lineNo: 10,
      colNo: 15,
    };
    expect(formatFrameHeader(jsFrame3)).toBe("/path/to/file.js:10:15");
  });

  it("formats Ruby stack traces correctly", () => {
    const rubyFrame = {
      filename: "/path/to/file.rb",
      function: "method_name",
      lineNo: 42,
    };
    expect(formatFrameHeader(rubyFrame)).toBe(
      "    from /path/to/file.rb:42:in `method_name`",
    );

    // Without function name
    const rubyFrame2 = {
      filename: "/path/to/file.rb",
      lineNo: 42,
    };
    expect(formatFrameHeader(rubyFrame2)).toBe(
      "    from /path/to/file.rb:42:in",
    );
  });

  it("formats PHP stack traces correctly", () => {
    // With frame index
    const phpFrame1 = {
      filename: "/path/to/file.php",
      function: "functionName",
      lineNo: 42,
    };
    expect(formatFrameHeader(phpFrame1, 0)).toBe(
      "#0 /path/to/file.php(42): functionName()",
    );

    // Without frame index
    const phpFrame2 = {
      filename: "/path/to/file.php",
      function: "functionName",
      lineNo: 42,
    };
    expect(formatFrameHeader(phpFrame2)).toBe(
      "/path/to/file.php(42): functionName()",
    );
  });

  it("formats unknown languages with generic format", () => {
    const unknownFrame = {
      filename: "/path/to/file.unknown",
      function: "someFunction",
      lineNo: 42,
    };
    expect(formatFrameHeader(unknownFrame)).toBe(
      "    at someFunction (/path/to/file.unknown:42)",
    );
  });

  it("prioritizes duck typing over platform when clear indicators exist", () => {
    // Java file but platform says python - should use Java format
    const javaFrame = {
      filename: "Example.java",
      module: "com.example.Example",
      function: "doSomething",
      lineNo: 42,
    };
    expect(formatFrameHeader(javaFrame, undefined, "python")).toBe(
      "at com.example.Example.doSomething(Example.java:42)",
    );

    // Python file but platform says java - should use Python format
    const pythonFrame = {
      filename: "/app/example.py",
      function: "do_something",
      lineNo: 42,
    };
    expect(formatFrameHeader(pythonFrame, undefined, "java")).toBe(
      '  File "/app/example.py", line 42, in do_something',
    );
  });
});

describe("formatEventOutput", () => {
  it("formats Java thread stack traces correctly", () => {
    const event: Event = {
      id: "test",
      title: "Test Error",
      message: null,
      platform: "java",
      type: "error",
      entries: [
        {
          type: "message",
          data: {
            formatted:
              "Cannot use this function, please use update(String sql, PreparedStatementSetter pss) instead",
          },
        },
        {
          type: "threads",
          data: {
            values: [
              {
                id: 187,
                name: "CONTRACT_WORKER",
                crashed: true,
                state: "RUNNABLE",
                stacktrace: {
                  frames: [
                    {
                      filename: "Thread.java",
                      module: "java.lang.Thread",
                      function: "run",
                      lineNo: 833,
                    },
                    {
                      filename: "AeronServer.java",
                      module: "com.citics.eqd.mq.aeron.AeronServer",
                      function: "lambda$start$3",
                      lineNo: 110,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      contexts: {},
    };

    const output = formatEventOutput(event);

    expect(output).toMatchInlineSnapshot(`
      "### Error

      \`\`\`
      Cannot use this function, please use update(String sql, PreparedStatementSetter pss) instead
      \`\`\`

      **Thread** (CONTRACT_WORKER)

      **Stacktrace:**
      \`\`\`
      at java.lang.Thread.run(Thread.java:833)
      at com.citics.eqd.mq.aeron.AeronServer.lambda$start$3(AeronServer.java:110)
      \`\`\`

      ### Additional Context

      These are additional context provided by the user when they're instrumenting their application.



      "
    `);
  });

  it("formats Python exception traces correctly", () => {
    const event: Event = {
      id: "test",
      title: "Test Error",
      message: null,
      platform: "python",
      type: "error",
      entries: [
        {
          type: "exception",
          data: {
            values: [
              {
                type: "ValueError",
                value: "Invalid value",
                stacktrace: {
                  frames: [
                    {
                      filename: "/app/main.py",
                      function: "process_data",
                      lineNo: 42,
                    },
                    {
                      filename: "/app/utils.py",
                      function: "validate",
                      lineNo: 15,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      contexts: {},
    };

    const output = formatEventOutput(event);

    expect(output).toMatchInlineSnapshot(`
      "### Error

      \`\`\`
      ValueError: Invalid value
      \`\`\`

      **Stacktrace:**
      \`\`\`
        File "/app/main.py", line 42, in process_data
        File "/app/utils.py", line 15, in validate
      \`\`\`

      ### Additional Context

      These are additional context provided by the user when they're instrumenting their application.



      "
    `);
  });
});
