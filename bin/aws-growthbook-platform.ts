#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

import { ApplicationStack } from '../lib/stacks/application-stack';
import { CoreNetworkStack } from "../lib/stacks/core-network-stack";
import { DocumentDbStack } from "../lib/stacks/document-db-stack";
import { ECRStack } from "../lib/stacks/ecr-stack";
import { IamStack } from "../lib/stacks/iam-stack";
import { SecretsStack } from "../lib/stacks/secrets-stack";
import { StreamingStorageStack } from "../lib/stacks/streaming-storage-stack";
import { RedshiftStack } from "../lib/stacks/redshift-stack";
import { FirehoseStack } from "../lib/stacks/firehose-stack";
import { ApplicationLambdasStack } from "../lib/stacks/application-lambdas-stack";
import { ApiGatewayStack } from "../lib/stacks/api-gateway-stack";
import { FrontendStack } from "../lib/stacks/frontend-stack";
import { AutomationStack } from "../lib/stacks/automation-stack";

const app = new cdk.App();

const env = {
  account:
    process.env.CDK_DEFAULT_ACCOUNT ?? app.node.tryGetContext("accountId"),
  region:
    process.env.CDK_DEFAULT_REGION ??
    app.node.tryGetContext("region") ??
    "eu-west-1",
};

const component = app.node.tryGetContext("component") || "growthbook-platform";
const domain = app.node.tryGetContext("domain") || "";
const onlyStack = app.node.tryGetContext("onlyStack") as string | undefined;
const frontendDomainName: string | undefined =
  app.node.tryGetContext("frontendDomainName");
const apiKey: string | undefined = app.node.tryGetContext("apiKey");

const ecr = new ECRStack(app, "ECRStack", {
  env,
  description: "ECR repository for the GrowthBook container image",
  component,
});

if (onlyStack !== "ECRStack") {
  const core = new CoreNetworkStack(app, 'CoreNetworkStack', {
    env,
    description: 'Core network (VPC) for the data platform',
    component,
  });

  const secrets = new SecretsStack(app, 'SecretsStack', {
    env,
    description: 'KMS key and SSM parameters for GrowthBook',
    component,
  });

  const iam = new IamStack(app, 'IamStack', {
    env,
    description: 'IAM policy and ECS task role for GrowthBook',
    component,
    kmsKeyArn: secrets.kms.keyArn,
    growthbookMongoDBStringParameterArn:
      secrets.growthbookMongoDBStringParameter.parameterArn,
    growthbookEncryptionKeyParameterArn:
      secrets.growthbookEncryptionKeyParameter.parameterArn,
    growthbookJWTParameterArn: secrets.growthbookJWTParameter.parameterArn,
    growthbookEmailUsernameParameterArn:
      secrets.growthbookEmailUsernameParameter.parameterArn,
    growthbookEmailPasswordParameterArn:
      secrets.growthbookEmailPasswordParameter.parameterArn,
  });

  const docdb = new DocumentDbStack(app, 'DocumentDbStack', {
    env,
    description: 'DocumentDB cluster for GrowthBook',
    component,
    vpc: core.vpc.vpc,
    kmsKey: secrets.kms,
  });

  const streamingStorage = new StreamingStorageStack(
    app,
    'StreamingStorageStack',
    {
      env,
      description: 'S3 bucket for Firehose staging and backup',
      component,
    },
  );

  const redshift = new RedshiftStack(app, 'RedshiftStack', {
    env,
    description: 'Redshift Serverless for GrowthBook analytics data source',
    component,
    vpc: core.vpc.vpc,
  });
  redshift.addDependency(core);

  const firehose = new FirehoseStack(app, 'FirehoseStack', {
    env,
    description:
      'Firehose delivery streams: analytics events and experiment activations to Redshift',
    component,
    firehoseBackupBucket: streamingStorage.firehoseBackupBucket,
    redshiftEndpointAddress: redshift.workgroupEndpointAddress,
    redshiftEndpointPort: redshift.workgroupEndpointPort,
    redshiftDatabaseName: redshift.databaseName,
    redshiftAdminSecret: redshift.adminSecret,
  });
  firehose.addDependency(streamingStorage);
  firehose.addDependency(redshift);

  const appLambdas = new ApplicationLambdasStack(
    app,
    'ApplicationLambdasStack',
    {
      env,
      description:
        'Lambda functions for events and orders fact table producers',
      component,
      eventsFirehoseStreamName: firehose.eventsFirehoseStreamName,
      ordersFirehoseStreamName: firehose.ordersFirehoseStreamName,
    },
  );
  appLambdas.addDependency(firehose);

  const api = new ApiGatewayStack(app, 'ApiGatewayStack', {
    env,
    description:
      'REST API for streaming events and orders to Redshift fact tables',
    component,
    eventsLambda: appLambdas.eventsLambda,
    ordersLambda: appLambdas.ordersLambda,
    corsOrigin: frontendDomainName
      ? `https://${frontendDomainName}`
      : undefined,
  });
  api.addDependency(appLambdas);

  const automation = new AutomationStack(app, 'AutomationStack', {
    env,
    description: 'Custom resources: auto-generate secrets, init Mongo/Redshift',
    component,
    encryptionKeyParameterArn:
      secrets.growthbookEncryptionKeyParameter.parameterArn,
    encryptionKeyParameterName:
      secrets.growthbookEncryptionKeyParameter.parameterName,
    jwtParameterArn: secrets.growthbookJWTParameter.parameterArn,
    jwtParameterName: secrets.growthbookJWTParameter.parameterName,
    docdbSecretArn: docdb.cluster.secret!.secretArn,
    docdbEndpoint: docdb.cluster.clusterEndpoint.hostname,
    mongoDbParameterArn: secrets.growthbookMongoDBStringParameter.parameterArn,
    mongoDbParameterName:
      secrets.growthbookMongoDBStringParameter.parameterName,
    redshiftWorkgroupName: redshift.workgroupName,
    redshiftDatabase: redshift.databaseName,
    redshiftAdminSecretArn: redshift.adminSecret.secretArn,
    redshiftUserSecretArn: redshift.growthbookUserSecret.secretArn,
  });
  automation.addDependency(docdb);
  automation.addDependency(redshift);

  const application = new ApplicationStack(app, 'ApplicationStack', {
    env,
    description:
      'ECS Fargate service, ALB, and Route 53 records for GrowthBook',
    component,
    vpc: core.vpc.vpc,
    ecsTaskRole: iam.growthbookServiceRole,
    ecsRepository: ecr.growthbookEcrRepository,
    domain,
    mongoDBStringParameter: secrets.growthbookMongoDBStringParameter,
    encryptionKeyParameter: secrets.growthbookEncryptionKeyParameter,
    jwtParameter: secrets.growthbookJWTParameter,
    emailUsernameParameter: secrets.growthbookEmailUsernameParameter,
    emailPasswordParameter: secrets.growthbookEmailPasswordParameter,
  });
  application.addDependency(automation);

  const frontend = new FrontendStack(app, 'FrontendStack', {
    env,
    description: 'Demo site for streaming events to GrowthBook',
    component,
    apiUrl: api.api.url,
    domainName: frontendDomainName,
    certificateArn: app.node.tryGetContext('frontendCertificateArn'),
    apiKey,
    growthbookAppUrl: application.publicAppUrl,
  });
  frontend.addDependency(api);
}
