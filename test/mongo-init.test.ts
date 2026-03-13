import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it, expect, beforeEach, vi } from "vitest";

type CommandInput = Record<string, string>;

function loadHandler(ssmSend: ReturnType<typeof vi.fn>, secretsSend: ReturnType<typeof vi.fn>) {
  const modulePath = path.resolve(
    __dirname,
    "../lambda/custom-resources/mongo-init/index.js",
  );
  const source = fs.readFileSync(modulePath, "utf8");

  class GetParameterCommand {
    input: CommandInput;

    constructor(input: CommandInput) {
      this.input = input;
    }
  }

  class PutParameterCommand {
    input: CommandInput;

    constructor(input: CommandInput) {
      this.input = input;
    }
  }

  class GetSecretValueCommand {
    input: CommandInput;

    constructor(input: CommandInput) {
      this.input = input;
    }
  }

  class SSMClient {
    send = ssmSend;
  }

  class SecretsManagerClient {
    send = secretsSend;
  }

  const mockedRequire = (id: string) => {
    if (id === "@aws-sdk/client-ssm") {
      return {
        SSMClient,
        GetParameterCommand,
        PutParameterCommand,
      };
    }

    if (id === "@aws-sdk/client-secrets-manager") {
      return {
        SecretsManagerClient,
        GetSecretValueCommand,
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
    secretArn: "arn:aws:secretsmanager:eu-west-1:123456789012:secret:docdb",
    endpoint: "example.cluster-abc.eu-west-1.docdb.amazonaws.com",
    ssmParam: "/growthbook/production/documentdb/dbstring",
  },
};

describe("mongo-init custom resource", () => {
  const ssmSend = vi.fn();
  const secretsSend = vi.fn();

  beforeEach(() => {
    ssmSend.mockReset();
    secretsSend.mockReset();
  });

  it("writes a DocumentDB URI with authSource=admin when value is stale", async () => {
    ssmSend
      .mockResolvedValueOnce({
        Parameter: {
          Value:
            "mongodb://docdbAdmin:oldpass@example.cluster-abc.eu-west-1.docdb.amazonaws.com:27017/growthbook?tls=true",
        },
      })
      .mockResolvedValueOnce({});

    secretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        username: "docdbAdmin",
        password: "new:P@ss",
      }),
    });

    const handler = loadHandler(ssmSend, secretsSend);
    await handler(baseEvent);

    expect(ssmSend).toHaveBeenCalledTimes(2);
    const putCommand = ssmSend.mock.calls[1][0];
    expect(putCommand.input.Name).toBe(
      "/growthbook/production/documentdb/dbstring",
    );
    expect(putCommand.input.Value).toContain("authSource=admin");
    expect(putCommand.input.Value).toContain("docdbAdmin:new%3AP%40ss@");
  });

  it("does not overwrite when SSM already matches generated URI", async () => {
    const expectedValue =
      "mongodb://docdbAdmin:new%3AP%40ss@example.cluster-abc.eu-west-1.docdb.amazonaws.com:27017/growthbook?tls=true&tlsCAFile=/usr/local/src/app/global-bundle.pem&replicaSet=rs0&retryWrites=false&authSource=admin";

    ssmSend.mockResolvedValueOnce({ Parameter: { Value: expectedValue } });
    secretsSend.mockResolvedValue({
      SecretString: JSON.stringify({
        username: "docdbAdmin",
        password: "new:P@ss",
      }),
    });

    const handler = loadHandler(ssmSend, secretsSend);
    await handler(baseEvent);

    expect(ssmSend).toHaveBeenCalledTimes(1);
  });

  it("returns early for delete events", async () => {
    const handler = loadHandler(ssmSend, secretsSend);

    const response = await handler({
      RequestType: "Delete",
      PhysicalResourceId: "existing-id",
      ResourceProperties: baseEvent.ResourceProperties,
    });

    expect(response).toEqual({ PhysicalResourceId: "existing-id" });
    expect(ssmSend).not.toHaveBeenCalled();
    expect(secretsSend).not.toHaveBeenCalled();
  });
});
