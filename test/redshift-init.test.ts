import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CommandInput = Record<string, unknown>;

function loadHandler(send: ReturnType<typeof vi.fn>) {
  const modulePath = path.resolve(
    __dirname,
    "../lambda/custom-resources/redshift-init/index.js",
  );
  const source = fs.readFileSync(modulePath, "utf8");

  class GetSecretValueCommand {
    input: CommandInput;

    constructor(input: CommandInput) {
      this.input = input;
    }
  }

  class BatchExecuteStatementCommand {
    input: CommandInput;

    constructor(input: CommandInput) {
      this.input = input;
    }
  }

  class DescribeStatementCommand {
    input: CommandInput;

    constructor(input: CommandInput) {
      this.input = input;
    }
  }

  class SecretsManagerClient {
    send = send;
  }

  class RedshiftDataClient {
    send = send;
  }

  const mockedRequire = (id: string) => {
    if (id === "@aws-sdk/client-secrets-manager") {
      return {
        SecretsManagerClient,
        GetSecretValueCommand,
      };
    }

    if (id === "@aws-sdk/client-redshift-data") {
      return {
        RedshiftDataClient,
        BatchExecuteStatementCommand,
        DescribeStatementCommand,
      };
    }

    throw new Error(`Unexpected module: ${id}`);
  };

  const cjsModule = {
    exports: {} as { handler: (event: any) => Promise<unknown> },
  };
  const wrapped = `(function(require, module, exports) {\n${source}\n})`;
  const factory = vm.runInThisContext(wrapped, { filename: modulePath }) as (
    require: (id: string) => unknown,
    module: typeof cjsModule,
    exports: typeof cjsModule.exports,
  ) => void;

  factory(mockedRequire, cjsModule, cjsModule.exports);

  return cjsModule.exports.handler;
}

const baseEvent = {
  RequestType: "Create",
  ResourceProperties: {
    workgroupName: "growthbook-platform-wg",
    database: "analytics",
    adminSecretArn:
      "arn:aws:secretsmanager:eu-west-1:123456789012:secret:redshift-admin",
    userSecretArn:
      "arn:aws:secretsmanager:eu-west-1:123456789012:secret:redshift-user",
  },
};

describe("redshift-init custom resource", () => {
  const send = vi.fn();
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((fn) => {
        if (typeof fn === "function") {
          fn();
        }
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

    send.mockReset();
    send.mockImplementation((command) => {
      const name = command.constructor.name;

      if (name === "GetSecretValueCommand") {
        return Promise.resolve({
          SecretString: JSON.stringify({ password: "password123" }),
        });
      }

      if (name === "BatchExecuteStatementCommand") {
        return Promise.resolve({ Id: `stmt-${send.mock.calls.length}` });
      }

      if (name === "DescribeStatementCommand") {
        return Promise.resolve({ Status: "FINISHED" });
      }

      throw new Error(`Unexpected command: ${name}`);
    });
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
  });

  it("creates GrowthBook-facing assignment and derived views", async () => {
    const handler = loadHandler(send);
    await handler(baseEvent);

    const batchCalls = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command.constructor.name === "BatchExecuteStatementCommand");

    expect(batchCalls).toHaveLength(3);

    const setupSql = batchCalls[0].input.Sqls.join("\n");
    expect(setupSql).toContain(
      "CREATE OR REPLACE VIEW experimentation.experiment_assignments AS",
    );
    expect(setupSql).toContain(
      "CREATE OR REPLACE VIEW experimentation.feature_usage AS",
    );
    expect(setupSql).toContain(
      "CREATE OR REPLACE VIEW experimentation.session_metrics AS",
    );
    expect(setupSql).toContain(
      "CREATE OR REPLACE VIEW experimentation.checkout_funnel AS",
    );
    expect(setupSql).toContain(
      "CREATE OR REPLACE VIEW experimentation.user_day_metrics AS",
    );

    const grantSql = batchCalls[2].input.Sqls.join("\n");
    expect(grantSql).toContain(
      "GRANT SELECT ON experimentation.experiment_assignments TO growthbook_user",
    );
    expect(grantSql).toContain(
      "GRANT SELECT ON experimentation.user_day_metrics TO growthbook_user",
    );
  });

  it("returns early for delete events", async () => {
    const handler = loadHandler(send);

    const response = await handler({
      RequestType: "Delete",
      PhysicalResourceId: "existing-id",
      ResourceProperties: baseEvent.ResourceProperties,
    });

    expect(response).toEqual({ PhysicalResourceId: "existing-id" });
    expect(send).not.toHaveBeenCalled();
  });
});
