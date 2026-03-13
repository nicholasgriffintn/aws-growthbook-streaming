import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { BaseStackProps } from "../shared/types";

export interface IamStackProps extends BaseStackProps {
  kmsKeyArn: string;
  growthbookMongoDBStringParameterArn?: string;
  growthbookEncryptionKeyParameterArn?: string;
  growthbookJWTParameterArn?: string;
  growthbookEmailUsernameParameterArn?: string;
  growthbookEmailPasswordParameterArn?: string;
}

export class IamStack extends cdk.Stack {
  public readonly component: string;
  public readonly growthbookServiceRole: iam.Role;
  public readonly growthbookServiceRolePolicy: iam.ManagedPolicy;

  constructor(
    scope: Construct,
    id: string,
    props: IamStackProps = {
      kmsKeyArn: "",
    },
  ) {
    super(scope, id, props);

    const { component = "data-platform" } = props;
    this.component = component;

    this.growthbookServiceRolePolicy = new iam.ManagedPolicy(
      this,
      "GrowthBookServiceRolePolicy",
      {
        managedPolicyName: "prod-growthbook-iamPolicy",
        statements: [
          new iam.PolicyStatement({
            sid: "AllowSSM",
            actions: ["ssm:GetParameters"],
            resources: [
              props.growthbookMongoDBStringParameterArn ?? "",
              props.growthbookEncryptionKeyParameterArn ?? "",
              props.growthbookJWTParameterArn ?? "",
              props.growthbookEmailUsernameParameterArn ?? "",
              props.growthbookEmailPasswordParameterArn ?? "",
            ].filter(Boolean),
          }),
          new iam.PolicyStatement({
            sid: "AllowDecrypt",
            actions: ["kms:Decrypt"],
            resources: [props.kmsKeyArn],
          }),
        ],
      },
    );

    this.growthbookServiceRole = new iam.Role(this, "GrowthBookServiceRole", {
      roleName: "prod-growthbookECSTask-iamRole",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "IAM role for GrowthBook ECS tasks",
      managedPolicies: [this.growthbookServiceRolePolicy],
    });
  }
}
