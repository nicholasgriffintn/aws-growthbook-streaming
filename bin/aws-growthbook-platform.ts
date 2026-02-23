#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";

import { ApplicationStack } from "../lib/stacks/application-stack";
import { CoreNetworkStack } from "../lib/stacks/core-network-stack";
import { DocumentDbStack } from "../lib/stacks/document-db-stack";
import { ECRStack } from "../lib/stacks/ecr-stack";
import { IamStack } from "../lib/stacks/iam-stack";
import { SecretsStack } from "../lib/stacks/secrets-stack";

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

const core = new CoreNetworkStack(app, "CoreNetworkStack", {
  env,
  description: "Core network (VPC) for the data platform",
  component,
});

const secrets = new SecretsStack(app, "SecretsStack", {
  env,
  description: "KMS key and SSM parameters for GrowthBook",
  component,
});

const iam = new IamStack(app, "IamStack", {
  env,
  description: "IAM policy and ECS task role for GrowthBook",
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

const ecr = new ECRStack(app, "ECRStack", {
  env,
  description: "ECR repository for the GrowthBook container image",
  component,
});

const application = new ApplicationStack(app, "ApplicationStack", {
  env,
  description: "ECS Fargate service, ALB, and Route 53 records for GrowthBook",
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

new DocumentDbStack(app, "DocumentDbStack", {
  env,
  description: "DocumentDB cluster for GrowthBook",
  component,
  vpc: core.vpc.vpc,
  kmsKey: secrets.kms,
  ecsTaskSecurityGroup: application.ecsTaskSg,
});
