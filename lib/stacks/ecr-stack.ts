import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";

import type { BaseStackProps } from "../shared/types";

export interface ECRStackProps extends BaseStackProps {}

export class ECRStack extends cdk.Stack {
  public readonly growthbookEcrRepository;

  constructor(scope: Construct, id: string, props: ECRStackProps = {}) {
    super(scope, id, props);

    this.growthbookEcrRepository = new cdk.aws_ecr.Repository(
      this,
      "GrowthBookEcrRepository",
      {
        repositoryName: "growthbook",
        lifecycleRules: [
          {
            maxImageCount: 5,
            rulePriority: 1,
            description: "Keep only the 5 most recent images",
          },
        ],
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    );
  }
}
