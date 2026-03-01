import * as cdk from "aws-cdk-lib";
import type { Construct } from "constructs";

import { FrontendConstruct } from "../constructs/web/frontend";
import { makeUniqueSuffix } from "../shared/naming";
import type { BaseStackProps } from "../shared/types";

export interface FrontendStackProps extends BaseStackProps {
  apiUrl: string;
  domainName?: string;
  certificateArn?: string;
  apiKey?: string;
}

export class FrontendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const {
      component = "growthbook-platform",
      apiUrl,
      domainName,
      certificateArn,
      apiKey,
    } = props;
    const uniqueSuffix = makeUniqueSuffix(this);

    new FrontendConstruct(this, "Frontend", {
      component,
      uniqueSuffix,
      apiUrl,
      domainName,
      certificateArn,
      apiKey,
    });
  }
}
