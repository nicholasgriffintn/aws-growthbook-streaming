import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";

import type { BaseStackProps } from "../shared/types";

export interface SecretsStackProps extends BaseStackProps {}

export class SecretsStack extends cdk.Stack {
  public readonly kms;
  public readonly component: string;
  public readonly growthbookMongoDBStringParameter;
  public readonly growthbookEncryptionKeyParameter;
  public readonly growthbookJWTParameter;
  public readonly growthbookEmailUsernameParameter;
  public readonly growthbookEmailPasswordParameter;

  constructor(scope: Construct, id: string, props: SecretsStackProps = {}) {
    super(scope, id, props);

    const { component = "data-platform" } = props;
    this.component = component;

    this.kms = new cdk.aws_kms.Key(this, "GrowthBookKmsKey", {
      description: "KMS key for encrypting GrowthBook production secrets",
      alias: "alias/prod-growthbook-kmsKey",
      enableKeyRotation: true,
      keySpec: cdk.aws_kms.KeySpec.SYMMETRIC_DEFAULT,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.growthbookMongoDBStringParameter = new cdk.aws_ssm.StringParameter(
      this,
      "GrowthBookMongoDBString",
      {
        description:
          "MongoDB connection string for GrowthBook (update after DocumentDB deploy)",
        parameterName: "/growthbook/production/documentdb/dbstring",
        stringValue: "REPLACE_ME",
        tier: cdk.aws_ssm.ParameterTier.STANDARD,
      },
    );

    this.growthbookEncryptionKeyParameter = new cdk.aws_ssm.StringParameter(
      this,
      "GrowthBookEncryptionKey",
      {
        description: "ENCRYPTION_KEY for GrowthBook",
        parameterName: "/growthbook/production/encryptionKey",
        stringValue: "REPLACE_ME",
        tier: cdk.aws_ssm.ParameterTier.STANDARD,
      },
    );

    this.growthbookJWTParameter = new cdk.aws_ssm.StringParameter(
      this,
      "GrowthBookJWT",
      {
        description: "JWT_SECRET for GrowthBook",
        parameterName: "/growthbook/production/jwt",
        stringValue: "REPLACE_ME",
        tier: cdk.aws_ssm.ParameterTier.STANDARD,
      },
    );

    this.growthbookEmailUsernameParameter = new cdk.aws_ssm.StringParameter(
      this,
      "GrowthBookEmailUsername",
      {
        description: "EMAIL_HOST_USER for GrowthBook (SES SMTP username)",
        parameterName: "/growthbook/production/email/username",
        stringValue: "REPLACE_ME",
        tier: cdk.aws_ssm.ParameterTier.STANDARD,
      },
    );

    this.growthbookEmailPasswordParameter = new cdk.aws_ssm.StringParameter(
      this,
      "GrowthBookEmailPassword",
      {
        description: "EMAIL_HOST_PASSWORD for GrowthBook (SES SMTP password)",
        parameterName: "/growthbook/production/email/password",
        stringValue: "REPLACE_ME",
        tier: cdk.aws_ssm.ParameterTier.STANDARD,
      },
    );
  }
}
