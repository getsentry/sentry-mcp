import { describe, it, expect } from "vitest";
import { formatEventOutput, formatFrameHeader } from "./formatting";
import type { Event } from "../api-client/types";
import {
  EventBuilder,
  createFrame,
  frameFactories,
  createStackTrace,
  createExceptionValue,
  createThread,
  testEvents,
  createFrameWithContext,
} from "./test-fixtures";

// Helper functions to reduce duplication in event creation
function createPythonExceptionEvent(
  errorType: string,
  errorMessage: string,
  frames: any[],
): Event {
  return new EventBuilder("python")
    .withException(
      createExceptionValue({
        type: errorType,
        value: errorMessage,
        stacktrace: createStackTrace(frames),
      }),
    )
    .build();
}

function createSimpleExceptionEvent(
  platform: string,
  errorType: string,
  errorMessage: string,
  frame: any,
): Event {
  const builder = new EventBuilder(platform);
  // Remove the contexts property to avoid "Additional Context" section
  const event = builder
    .withException(
      createExceptionValue({
        type: errorType,
        value: errorMessage,
        stacktrace: createStackTrace([frame]),
      }),
    )
    .build();
  // Remove contexts to match original test expectations
  event.contexts = undefined;
  return event;
}

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
    const event = testEvents.javaThreadError(
      "Cannot use this function, please use update(String sql, PreparedStatementSetter pss) instead",
    );

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
      "
    `);
  });

  it("formats Python exception traces correctly", () => {
    const event = testEvents.pythonException("Invalid value");

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

      "
    `);
  });

  it("should render enhanced in-app frame with context lines", () => {
    const event = new EventBuilder("python")
      .withException(
        createExceptionValue({
          type: "ValueError",
          value: "Something went wrong",
          stacktrace: createStackTrace([
            createFrame({
              filename: "/usr/lib/python3.8/json/__init__.py",
              function: "loads",
              lineNo: 357,
              inApp: false,
            }),
            createFrameWithContext(
              {
                filename: "/app/services/payment.py",
                function: "process_payment",
                lineNo: 42,
              },
              [
                [37, "    def process_payment(self, amount, user_id):"],
                [38, "        user = self.get_user(user_id)"],
                [39, "        if not user:"],
                [40, '            raise ValueError("User not found")'],
                [41, "        "],
                [42, "        balance = user.account.balance"],
                [43, "        if balance < amount:"],
                [44, "            raise InsufficientFundsError()"],
                [45, "        "],
                [46, "        transaction = Transaction(user, amount)"],
              ],
            ),
          ]),
        }),
      )
      .build();

    const output = formatEventOutput(event);

    expect(output).toMatchInlineSnapshot(`
      "### Error

      \`\`\`
      ValueError: Something went wrong
      \`\`\`

      **Most Relevant Frame:**
      ─────────────────────
        File "/app/services/payment.py", line 42, in process_payment

          39 │         if not user:
          40 │             raise ValueError("User not found")
          41 │         
        → 42 │         balance = user.account.balance
          43 │         if balance < amount:
          44 │             raise InsufficientFundsError()
          45 │         

      **Full Stacktrace:**
      ────────────────
      \`\`\`
        File "/usr/lib/python3.8/json/__init__.py", line 357, in loads
        File "/app/services/payment.py", line 42, in process_payment
              balance = user.account.balance
      \`\`\`

      "
    `);
  });

  it("should render enhanced in-app frame with variables", () => {
    const event = new EventBuilder("python")
      .withException(
        createExceptionValue({
          type: "ValueError",
          value: "Something went wrong",
          stacktrace: createStackTrace([
            createFrame({
              filename: "/app/services/payment.py",
              function: "process_payment",
              lineNo: 42,
              inApp: true,
              vars: {
                amount: 150.0,
                user_id: "usr_123456",
                user: null,
                self: { type: "PaymentService", id: 1234 },
              },
            }),
          ]),
        }),
      )
      .build();

    const output = formatEventOutput(event);

    expect(output).toMatchInlineSnapshot(`
      "### Error

      \`\`\`
      ValueError: Something went wrong
      \`\`\`

      **Most Relevant Frame:**
      ─────────────────────
        File "/app/services/payment.py", line 42, in process_payment

      Local Variables:
      ├─ amount: 150
      ├─ user_id: "usr_123456"
      ├─ user: null
      └─ self: {"type":"PaymentService","id":1234}

      **Full Stacktrace:**
      ────────────────
      \`\`\`
        File "/app/services/payment.py", line 42, in process_payment
      \`\`\`

      "
    `);
  });

  it("should handle frames without in-app or enhanced data", () => {
    const event = new EventBuilder("python")
      .withException(
        createExceptionValue({
          type: "ValueError",
          value: "Something went wrong",
          stacktrace: createStackTrace([
            frameFactories.python({ lineNo: 10, function: "main" }),
          ]),
        }),
      )
      .build();

    const output = formatEventOutput(event);

    expect(output).toMatchInlineSnapshot(`
      "### Error

      \`\`\`
      ValueError: Something went wrong
      \`\`\`

      **Stacktrace:**
      \`\`\`
        File "/app/main.py", line 10, in main
      \`\`\`

      "
    `);
  });

  it("should work with thread interface containing in-app frame", () => {
    const event = new EventBuilder("java")
      .withThread(
        createThread({
          id: 1,
          crashed: true,
          name: "main",
          stacktrace: createStackTrace([
            frameFactories.java({
              module: "java.lang.Thread",
              function: "run",
              filename: "Thread.java",
              lineNo: 748,
              inApp: false,
            }),
            createFrameWithContext(
              {
                module: "com.example.PaymentService",
                function: "processPayment",
                filename: "PaymentService.java",
                lineNo: 42,
              },
              [
                [40, "        User user = getUser(userId);"],
                [41, "        if (user == null) {"],
                [42, "            throw new UserNotFoundException(userId);"],
                [43, "        }"],
                [44, "        return user.getBalance();"],
              ],
              {
                userId: "12345",
                user: null,
              },
            ),
          ]),
        }),
      )
      .build();

    const output = formatEventOutput(event);

    expect(output).toMatchInlineSnapshot(`
      "**Thread** (main)

      **Most Relevant Frame:**
      ─────────────────────
      at com.example.PaymentService.processPayment(PaymentService.java:42)

          40 │         User user = getUser(userId);
          41 │         if (user == null) {
        → 42 │             throw new UserNotFoundException(userId);
          43 │         }
          44 │         return user.getBalance();

      Local Variables:
      ├─ userId: "12345"
      └─ user: null

      **Full Stacktrace:**
      ────────────────
      \`\`\`
      at java.lang.Thread.run(Thread.java:748)
      at com.example.PaymentService.processPayment(PaymentService.java:42)
                  throw new UserNotFoundException(userId);
      \`\`\`
      "
    `);
  });

  describe("Enhanced frame rendering variations", () => {
    it("should handle Python format with enhanced frame", () => {
      const event = createSimpleExceptionEvent(
        "python",
        "AttributeError",
        "'NoneType' object has no attribute 'balance'",
        createFrameWithContext(
          {
            filename: "/app/models/user.py",
            function: "get_balance",
            lineNo: 25,
          },
          [
            [23, "    def get_balance(self):"],
            [24, "        # This will fail if account is None"],
            [25, "        return self.account.balance"],
            [26, ""],
            [27, "    def set_balance(self, amount):"],
          ],
          {
            self: { id: 123, account: null },
          },
        ),
      );

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        AttributeError: 'NoneType' object has no attribute 'balance'
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
          File "/app/models/user.py", line 25, in get_balance

            23 │     def get_balance(self):
            24 │         # This will fail if account is None
          → 25 │         return self.account.balance
            26 │ 
            27 │     def set_balance(self, amount):

        Local Variables:
        └─ self: {"id":123,"account":null}

        **Full Stacktrace:**
        ────────────────
        \`\`\`
          File "/app/models/user.py", line 25, in get_balance
                return self.account.balance
        \`\`\`

        "
      `);
    });

    it("should handle JavaScript format with enhanced frame", () => {
      const event = createSimpleExceptionEvent(
        "javascript",
        "TypeError",
        "Cannot read property 'name' of undefined",
        createFrameWithContext(
          {
            filename: "/src/components/UserProfile.tsx",
            function: "UserProfile",
            lineNo: 15,
            colNo: 28,
          },
          [
            [
              13,
              "export const UserProfile: React.FC<Props> = ({ userId }) => {",
            ],
            [14, "  const user = useUser(userId);"],
            [15, "  const displayName = user.profile.name;"],
            [16, "  "],
            [17, "  return ("],
          ],
          {
            userId: "usr_123",
            user: undefined,
            displayName: undefined,
          },
        ),
      );

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        TypeError: Cannot read property 'name' of undefined
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
        /src/components/UserProfile.tsx:15:28 (UserProfile)

            13 │ export const UserProfile: React.FC<Props> = ({ userId }) => {
            14 │   const user = useUser(userId);
          → 15 │   const displayName = user.profile.name;
            16 │   
            17 │   return (

        Local Variables:
        ├─ userId: "usr_123"
        ├─ user: undefined
        └─ displayName: undefined

        **Full Stacktrace:**
        ────────────────
        \`\`\`
        /src/components/UserProfile.tsx:15:28 (UserProfile)
          const displayName = user.profile.name;
        \`\`\`

        "
      `);
    });

    it("should handle Ruby format with enhanced frame", () => {
      const event = new EventBuilder("ruby")
        .withException(
          createExceptionValue({
            type: "NoMethodError",
            value: "undefined method `charge' for nil:NilClass",
            stacktrace: createStackTrace([
              createFrameWithContext(
                {
                  filename: "/app/services/payment_service.rb",
                  function: "process_payment",
                  lineNo: 8,
                },
                [
                  [6, "  def process_payment(amount)"],
                  [7, "    payment_method = user.payment_method"],
                  [8, "    payment_method.charge(amount)"],
                  [9, "  rescue => e"],
                  [10, "    Rails.logger.error(e)"],
                ],
                {
                  amount: 99.99,
                  payment_method: null,
                },
              ),
            ]),
          }),
        )
        .build();

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        NoMethodError: undefined method \`charge' for nil:NilClass
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
            from /app/services/payment_service.rb:8:in \`process_payment\`

             6 │   def process_payment(amount)
             7 │     payment_method = user.payment_method
          →  8 │     payment_method.charge(amount)
             9 │   rescue => e
            10 │     Rails.logger.error(e)

        Local Variables:
        ├─ amount: 99.99
        └─ payment_method: null

        **Full Stacktrace:**
        ────────────────
        \`\`\`
            from /app/services/payment_service.rb:8:in \`process_payment\`
            payment_method.charge(amount)
        \`\`\`

        "
      `);
    });

    it("should handle PHP format with enhanced frame", () => {
      const event = new EventBuilder("php")
        .withException(
          createExceptionValue({
            type: "Error",
            value: "Call to a member function getName() on null",
            stacktrace: createStackTrace([
              createFrameWithContext(
                {
                  filename: "/var/www/app/User.php",
                  function: "getDisplayName",
                  lineNo: 45,
                },
                [
                  [43, "    public function getDisplayName() {"],
                  [44, "        $profile = $this->getProfile();"],
                  [45, "        return $profile->getName();"],
                  [46, "    }"],
                ],
                {
                  profile: null,
                },
              ),
            ]),
          }),
        )
        .build();

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        Error: Call to a member function getName() on null
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
        /var/www/app/User.php(45): getDisplayName()

            43 │     public function getDisplayName() {
            44 │         $profile = $this->getProfile();
          → 45 │         return $profile->getName();
            46 │     }

        Local Variables:
        └─ profile: null

        **Full Stacktrace:**
        ────────────────
        \`\`\`
        /var/www/app/User.php(45): getDisplayName()
                return $profile->getName();
        \`\`\`

        "
      `);
    });

    it("should handle frame with context but no vars", () => {
      const event = new EventBuilder("python")
        .withException(
          createExceptionValue({
            type: "ValueError",
            value: "Invalid configuration",
            stacktrace: createStackTrace([
              createFrameWithContext(
                {
                  filename: "/app/config.py",
                  function: "load_config",
                  lineNo: 12,
                },
                [
                  [10, "def load_config():"],
                  [11, "    if not os.path.exists(CONFIG_FILE):"],
                  [12, "        raise ValueError('Invalid configuration')"],
                  [13, "    with open(CONFIG_FILE) as f:"],
                  [14, "        return json.load(f)"],
                ],
              ),
            ]),
          }),
        )
        .build();

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        ValueError: Invalid configuration
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
          File "/app/config.py", line 12, in load_config

            10 │ def load_config():
            11 │     if not os.path.exists(CONFIG_FILE):
          → 12 │         raise ValueError('Invalid configuration')
            13 │     with open(CONFIG_FILE) as f:
            14 │         return json.load(f)

        **Full Stacktrace:**
        ────────────────
        \`\`\`
          File "/app/config.py", line 12, in load_config
                raise ValueError('Invalid configuration')
        \`\`\`

        "
      `);
    });

    it("should handle frame with vars but no context", () => {
      const event = createSimpleExceptionEvent(
        "python",
        "TypeError",
        "unsupported operand type(s)",
        createFrame({
          filename: "/app/calculator.py",
          function: "divide",
          lineNo: 5,
          inApp: true,
          vars: {
            numerator: 10,
            denominator: "0",
            result: undefined,
          },
        }),
      );

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        TypeError: unsupported operand type(s)
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
          File "/app/calculator.py", line 5, in divide

        Local Variables:
        ├─ numerator: 10
        ├─ denominator: "0"
        └─ result: undefined

        **Full Stacktrace:**
        ────────────────
        \`\`\`
          File "/app/calculator.py", line 5, in divide
        \`\`\`

        "
      `);
    });

    it("should handle complex variable types", () => {
      const event = createSimpleExceptionEvent(
        "python",
        "KeyError",
        "'missing_key'",
        createFrame({
          filename: "/app/processor.py",
          function: "process_data",
          lineNo: 30,
          inApp: true,
          vars: {
            string_var: "hello world",
            number_var: 42,
            float_var: 3.14,
            bool_var: true,
            null_var: null,
            undefined_var: undefined,
            array_var: [1, 2, 3],
            object_var: { type: "User", id: 123 },
            nested_object: {
              user: { name: "John", age: 30 },
              settings: { theme: "dark" },
            },
            empty_string: "",
            zero: 0,
            false_bool: false,
            long_string:
              "This is a very long string that should be handled properly in the output",
          },
        }),
      );

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        KeyError: 'missing_key'
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
          File "/app/processor.py", line 30, in process_data

        Local Variables:
        ├─ string_var: "hello world"
        ├─ number_var: 42
        ├─ float_var: 3.14
        ├─ bool_var: true
        ├─ null_var: null
        ├─ undefined_var: undefined
        ├─ array_var: [1,2,3]
        ├─ object_var: {"type":"User","id":123}
        ├─ nested_object: {"user":{"name":"John","age":30},"settings":{"theme":"dark"}}
        ├─ empty_string: ""
        ├─ zero: 0
        ├─ false_bool: false
        └─ long_string: "This is a very long string that should be handled properly in the output"

        **Full Stacktrace:**
        ────────────────
        \`\`\`
          File "/app/processor.py", line 30, in process_data
        \`\`\`

        "
      `);
    });

    it("should truncate very long objects and arrays", () => {
      const event = new EventBuilder("python")
        .withException(
          createExceptionValue({
            type: "ValueError",
            value: "Data processing error",
            stacktrace: createStackTrace([
              createFrame({
                filename: "/app/processor.py",
                function: "process_batch",
                lineNo: 45,
                inApp: true,
                vars: {
                  small_array: [1, 2, 3],
                  large_array: Array(100)
                    .fill(0)
                    .map((_, i) => i),
                  small_object: { name: "test", value: 123 },
                  large_object: {
                    data: Array(50)
                      .fill(0)
                      .reduce(
                        (acc, _, i) => {
                          acc[`field${i}`] = `value${i}`;
                          return acc;
                        },
                        {} as Record<string, string>,
                      ),
                  },
                },
              }),
            ]),
          }),
        )
        .build();

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        ValueError: Data processing error
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
          File "/app/processor.py", line 45, in process_batch

        Local Variables:
        ├─ small_array: [1,2,3]
        ├─ large_array: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26, ...]
        ├─ small_object: {"name":"test","value":123}
        └─ large_object: {"data":{"field0":"value0","field1":"value1","field2":"value2", ...}

        **Full Stacktrace:**
        ────────────────
        \`\`\`
          File "/app/processor.py", line 45, in process_batch
        \`\`\`

        "
      `);
    });

    it("should show proper truncation format", () => {
      const event = new EventBuilder("javascript")
        .withException(
          createExceptionValue({
            type: "Error",
            value: "Test error",
            stacktrace: createStackTrace([
              createFrame({
                filename: "/app/test.js",
                function: "test",
                lineNo: 1,
                inApp: true,
                vars: {
                  shortArray: [1, 2, 3],
                  // This will be over 80 chars when stringified
                  longArray: [
                    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
                    18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
                  ],
                  shortObject: { a: 1, b: 2 },
                  // This will be over 80 chars when stringified
                  longObject: {
                    field1: "value1",
                    field2: "value2",
                    field3: "value3",
                    field4: "value4",
                    field5: "value5",
                    field6: "value6",
                    field7: "value7",
                    field8: "value8",
                  },
                },
              }),
            ]),
          }),
        )
        .build();

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        Error: Test error
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
        /app/test.js:1 (test)

        Local Variables:
        ├─ shortArray: [1,2,3]
        ├─ longArray: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27, ...]
        ├─ shortObject: {"a":1,"b":2}
        └─ longObject: {"field1":"value1","field2":"value2","field3":"value3","field4":"value4", ...}

        **Full Stacktrace:**
        ────────────────
        \`\`\`
        /app/test.js:1 (test)
        \`\`\`

        "
      `);
    });

    it("should handle circular references gracefully", () => {
      const circular: any = { name: "test" };
      circular.self = circular;

      const event = new EventBuilder("javascript")
        .withException(
          createExceptionValue({
            type: "TypeError",
            value: "Circular reference detected",
            stacktrace: createStackTrace([
              createFrame({
                filename: "/app/utils.js",
                function: "serialize",
                lineNo: 10,
                inApp: true,
                vars: {
                  normal: { a: 1, b: 2 },
                  circular: circular,
                },
              }),
            ]),
          }),
        )
        .build();

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        TypeError: Circular reference detected
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
        /app/utils.js:10 (serialize)

        Local Variables:
        ├─ normal: {"a":1,"b":2}
        └─ circular: <object>

        **Full Stacktrace:**
        ────────────────
        \`\`\`
        /app/utils.js:10 (serialize)
        \`\`\`

        "
      `);
    });

    it("should handle empty vars object", () => {
      const event = createSimpleExceptionEvent(
        "python",
        "RuntimeError",
        "Something went wrong",
        createFrame({
          filename: "/app/main.py",
          function: "main",
          lineNo: 1,
          inApp: true,
          vars: {},
        }),
      );

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        RuntimeError: Something went wrong
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
          File "/app/main.py", line 1, in main

        **Full Stacktrace:**
        ────────────────
        \`\`\`
          File "/app/main.py", line 1, in main
        \`\`\`

        "
      `);
    });

    it("should handle large context with proper windowing", () => {
      const event = createSimpleExceptionEvent(
        "python",
        "IndexError",
        "list index out of range",
        createFrameWithContext(
          {
            filename: "/app/processor.py",
            function: "process_items",
            lineNo: 50,
          },
          [
            [45, "    # Setup phase"],
            [46, "    items = get_items()"],
            [47, "    results = []"],
            [48, "    "],
            [49, "    # This line causes the error"],
            [50, "    first_item = items[0]"],
            [51, "    "],
            [52, "    # Process items"],
            [53, "    for item in items:"],
            [54, "        results.append(process(item))"],
            [55, "    return results"],
          ],
          {
            items: [],
          },
        ),
      );

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        IndexError: list index out of range
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
          File "/app/processor.py", line 50, in process_items

            47 │     results = []
            48 │     
            49 │     # This line causes the error
          → 50 │     first_item = items[0]
            51 │     
            52 │     # Process items
            53 │     for item in items:

        Local Variables:
        └─ items: []

        **Full Stacktrace:**
        ────────────────
        \`\`\`
          File "/app/processor.py", line 50, in process_items
            first_item = items[0]
        \`\`\`

        "
      `);
    });

    it("should handle context at beginning of file", () => {
      const event = createSimpleExceptionEvent(
        "python",
        "ImportError",
        "No module named 'missing_module'",
        createFrameWithContext(
          {
            filename: "/app/startup.py",
            function: "<module>",
            lineNo: 2,
          },
          [
            [1, "import os"],
            [2, "import missing_module"],
            [3, "import json"],
            [4, ""],
            [5, "def main():"],
          ],
        ),
      );

      const output = formatEventOutput(event);

      expect(output).toMatchInlineSnapshot(`
        "### Error

        \`\`\`
        ImportError: No module named 'missing_module'
        \`\`\`

        **Most Relevant Frame:**
        ─────────────────────
          File "/app/startup.py", line 2, in <module>

            1 │ import os
          → 2 │ import missing_module
            3 │ import json
            4 │ 
            5 │ def main():

        **Full Stacktrace:**
        ────────────────
        \`\`\`
          File "/app/startup.py", line 2, in <module>
        import missing_module
        \`\`\`

        "
      `);
    });
  });
});
