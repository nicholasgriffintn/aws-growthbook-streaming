import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, it, expect, beforeAll } from "vitest";

import { SecretsStack } from "../lib/stacks/secrets-stack";
import { ApplicationStack } from "../lib/stacks/application-stack";
import { ApiGatewayStack } from "../lib/stacks/api-gateway-stack";
import { AutomationStack } from "../lib/stacks/automation-stack";
import { FirehoseStack } from "../lib/stacks/firehose-stack";
import { StreamingStorageStack } from "../lib/stacks/streaming-storage-stack";
import { RedshiftStack } from "../lib/stacks/redshift-stack";

function makeApp() {
  return new cdk.App({ context: { "aws:cdk:enableDiffNoFail": "true" } });
}

describe("SecretsStack", () => {
  const app = makeApp();
  const stack = new SecretsStack(app, "TestSecretsStack");
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(stack);
  });

  it("KMS key has rotation enabled", () => {
    template.hasResourceProperties("AWS::KMS::Key", {
      EnableKeyRotation: true,
    });
  });

  it("KMS key is retained on stack destroy", () => {
    template.hasResource("AWS::KMS::Key", {
      DeletionPolicy: "Retain",
    });
  });

  it("creates five SSM parameters", () => {
    template.resourceCountIs("AWS::SSM::Parameter", 5);
  });
});

describe("ApiGatewayStack", () => {
  const app = makeApp();

  const lambdaStack = new cdk.Stack(app, "LambdaStubStack");
  const stubCode = lambda.Code.fromInline("exports.handler = async () => ({})");
  const eventsLambda = new lambda.Function(lambdaStack, "EventsFn", {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: stubCode,
  });
  const ordersLambda = new lambda.Function(lambdaStack, "OrdersFn", {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: "index.handler",
    code: stubCode,
  });

  const stack = new ApiGatewayStack(app, "TestApiGatewayStack", {
    eventsLambda,
    ordersLambda,
    corsOrigin: "https://demo.example.com",
  });
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(stack);
  });

  it("creates exactly one API key", () => {
    template.resourceCountIs("AWS::ApiGateway::ApiKey", 1);
  });

  it("creates exactly one usage plan", () => {
    template.resourceCountIs("AWS::ApiGateway::UsagePlan", 1);
  });

  it("usage plan has throttle and quota configured", () => {
    template.hasResourceProperties("AWS::ApiGateway::UsagePlan", {
      Throttle: { RateLimit: 100, BurstLimit: 200 },
      Quota: { Limit: 100000, Period: "DAY" },
    });
  });

  it("/events POST requires an API key", () => {
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "POST",
      ApiKeyRequired: true,
    });
  });

  it("/health GET does not require an API key", () => {
    // CDK omits ApiKeyRequired from the template when it is the default (false).
    template.hasResourceProperties("AWS::ApiGateway::Method", {
      HttpMethod: "GET",
      ApiKeyRequired: Match.absent(),
    });
  });

  it("emits ApiUrl and ApiKeyId outputs", () => {
    const outputs = template.findOutputs("*");
    const keys = Object.keys(outputs);
    expect(keys).toContain("ApiUrl");
    expect(keys).toContain("ApiKeyId");
  });
});

describe("ApplicationStack (no custom domain)", () => {
  const app = makeApp();

  const importsStack = new cdk.Stack(app, "ApplicationImportsStack");
  const vpc = cdk.aws_ec2.Vpc.fromVpcAttributes(importsStack, "Vpc", {
    vpcId: "vpc-1234567890abcdef0",
    availabilityZones: ["eu-west-1a", "eu-west-1b"],
    publicSubnetIds: ["subnet-public-a", "subnet-public-b"],
    privateSubnetIds: ["subnet-private-a", "subnet-private-b"],
  });
  const role = cdk.aws_iam.Role.fromRoleArn(
    importsStack,
    "TaskRole",
    "arn:aws:iam::123456789012:role/growthbook-task-role",
    { mutable: false },
  );
  const repo = cdk.aws_ecr.Repository.fromRepositoryName(
    importsStack,
    "Repo",
    "growthbook",
  );
  const mongo = cdk.aws_ssm.StringParameter.fromStringParameterName(
    importsStack,
    "Mongo",
    "/test/mongo",
  );
  const encryption = cdk.aws_ssm.StringParameter.fromStringParameterName(
    importsStack,
    "Encryption",
    "/test/encryption",
  );
  const jwt = cdk.aws_ssm.StringParameter.fromStringParameterName(
    importsStack,
    "Jwt",
    "/test/jwt",
  );
  const emailUser = cdk.aws_ssm.StringParameter.fromStringParameterName(
    importsStack,
    "EmailUser",
    "/test/email-user",
  );
  const emailPassword = cdk.aws_ssm.StringParameter.fromStringParameterName(
    importsStack,
    "EmailPassword",
    "/test/email-password",
  );

  const stack = new ApplicationStack(app, "TestApplicationStackNoDomain", {
    vpc,
    ecsTaskRole: role,
    ecsRepository: repo,
    mongoDBStringParameter: mongo,
    encryptionKeyParameter: encryption,
    jwtParameter: jwt,
    emailUsernameParameter: emailUser,
    emailPasswordParameter: emailPassword,
  });
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(stack);
  });

  it("does not create ACM certificates or Route53 records", () => {
    template.resourceCountIs("AWS::CertificateManager::Certificate", 0);
    template.resourceCountIs("AWS::Route53::RecordSet", 0);
  });

  it("creates separate app and API ALBs with HTTP listeners", () => {
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 2);
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::Listener", 2);
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::ListenerRule", 0);

    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 80,
      Protocol: "HTTP",
    });
  });

  it("emits both ALB URLs", () => {
    const outputs = template.findOutputs("*");
    const keys = Object.keys(outputs);
    expect(keys).toContain("AppAlbUrl");
    expect(keys).toContain("ApiAlbUrl");
  });
});

describe("FirehoseStack", () => {
  const app = makeApp();

  const storageStack = new StreamingStorageStack(
    app,
    "TestStreamingStorageStack",
    { component: "test" },
  );
  const vpcStack = new cdk.Stack(app, "VpcStubStack");
  const vpc = new cdk.aws_ec2.Vpc(vpcStack, "Vpc");
  const redshiftStack = new RedshiftStack(app, "TestRedshiftStack", { vpc });

  const stack = new FirehoseStack(app, "TestFirehoseStack", {
    firehoseBackupBucket: storageStack.firehoseBackupBucket,
    redshiftEndpointAddress: redshiftStack.workgroupEndpointAddress,
    redshiftDatabaseName: redshiftStack.databaseName,
    redshiftAdminSecret: redshiftStack.adminSecret,
  });
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(stack);
  });

  it("creates two Firehose delivery streams", () => {
    template.resourceCountIs("AWS::KinesisFirehose::DeliveryStream", 2);
  });

  it("creates a delivery-stalled alarm for events", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "DeliveryToRedshift.DataFreshness",
      Threshold: 300,
      EvaluationPeriods: 2,
    });
  });

  it("creates two delivery-stalled alarms in total", () => {
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });
});

describe("RedshiftStack", () => {
  const app = makeApp();
  const vpcStack = new cdk.Stack(app, "VpcStubStack2");
  const vpc = new cdk.aws_ec2.Vpc(vpcStack, "Vpc2");
  const stack = new RedshiftStack(app, "TestRedshiftStack2", { vpc });
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(stack);
  });

  it("creates two Secrets Manager secrets (admin + growthbook_user)", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 2);
  });

  it("admin secret has the correct name prefix", () => {
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "/growthbook-platform/redshift/admin",
    });
  });

  it("growthbook_user secret has the correct name prefix", () => {
    template.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "/growthbook-platform/redshift/growthbook-user",
    });
  });

  it("emits WorkgroupEndpoint, AdminSecretArn, and GrowthbookUserSecretArn outputs", () => {
    const outputs = template.findOutputs("*");
    const keys = Object.keys(outputs);
    expect(keys).toContain("WorkgroupEndpoint");
    expect(keys).toContain("AdminSecretArn");
    expect(keys).toContain("GrowthbookUserSecretArn");
  });

  it("places the workgroup in public subnets for Firehose connectivity", () => {
    const workgroups = template.findResources(
      "AWS::RedshiftServerless::Workgroup",
    );
    const workgroup = Object.values(workgroups)[0] as {
      Properties: { SubnetIds: unknown };
    };

    const subnetIdsJson = JSON.stringify(workgroup.Properties.SubnetIds);
    expect(subnetIdsJson).toContain("PublicSubnet");
    expect(subnetIdsJson).not.toContain("PrivateSubnet");
  });
});

describe("AutomationStack", () => {
  const app = makeApp();

  const stack = new AutomationStack(app, "TestAutomationStack", {
    encryptionKeyParameterArn:
      "arn:aws:ssm:eu-west-1:123456789012:parameter/enc",
    encryptionKeyParameterName: "/growthbook/production/encryptionKey",
    jwtParameterArn: "arn:aws:ssm:eu-west-1:123456789012:parameter/jwt",
    jwtParameterName: "/growthbook/production/jwt",
    docdbSecretArn:
      "arn:aws:secretsmanager:eu-west-1:123456789012:secret:docdb",
    docdbEndpoint: "docdb-cluster.cluster-xyz.eu-west-1.docdb.amazonaws.com",
    mongoDbParameterArn: "arn:aws:ssm:eu-west-1:123456789012:parameter/mongo",
    mongoDbParameterName: "/growthbook/production/documentdb/dbstring",
    redshiftWorkgroupName: "growthbook-platform-wg",
    redshiftDatabase: "analytics",
    redshiftAdminSecretArn:
      "arn:aws:secretsmanager:eu-west-1:123456789012:secret:rs-admin",
    redshiftUserSecretArn:
      "arn:aws:secretsmanager:eu-west-1:123456789012:secret:rs-user",
  });
  let template: Template;

  beforeAll(() => {
    template = Template.fromStack(stack);
  });

  it("creates six Lambda functions (three user-defined + three cr.Provider framework)", () => {
    // Each cr.Provider synthesises one internal framework Lambda alongside the
    // user-supplied onEventHandler, so 3 providers × 2 = 6 total.
    template.resourceCountIs("AWS::Lambda::Function", 6);
  });

  it("creates three custom resources", () => {
    template.resourceCountIs("AWS::CloudFormation::CustomResource", 3);
  });

  it("init-secrets Lambda has correct description", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Description: "Generates random ENCRYPTION_KEY and JWT_SECRET in SSM",
    });
  });

  it("redshift-init Lambda has a 2-minute timeout", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Description:
        "Creates experimentation schema, fact tables, derived views, and growthbook_user in Redshift",
      Timeout: 120,
    });
  });
});
