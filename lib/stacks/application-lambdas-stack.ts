import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

import {
  makeUniqueSuffix,
  makeName,
  makeLambdaLogGroupName,
} from "../shared/naming";
import type { BaseStackProps } from "../shared/types";

export interface ApplicationLambdasStackProps extends BaseStackProps {
  eventsFirehoseStreamName: string;
  ordersFirehoseStreamName: string;
}

export class ApplicationLambdasStack extends cdk.Stack {
  public readonly eventsLambda: lambda.Function;
  public readonly ordersLambda: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    props: ApplicationLambdasStackProps,
  ) {
    super(scope, id, props);

    const {
      component = "growthbook-platform",
      eventsFirehoseStreamName,
      ordersFirehoseStreamName,
    } = props;
    const uniqueSuffix = makeUniqueSuffix(this);
    const stack = cdk.Stack.of(this);

    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
      inlinePolicies: {
        FirehoseAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["firehose:PutRecord"],
              resources: [
                `arn:${stack.partition}:firehose:${stack.region}:${stack.account}:deliverystream/${eventsFirehoseStreamName}`,
                `arn:${stack.partition}:firehose:${stack.region}:${stack.account}:deliverystream/${ordersFirehoseStreamName}`,
              ],
            }),
          ],
        }),
      },
    });

    const eventsLogGroup = new logs.LogGroup(this, "EventsLogGroup", {
      logGroupName: makeLambdaLogGroupName(component, "events", uniqueSuffix),
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.eventsLambda = new lambda.Function(this, "EventsLambda", {
      functionName: makeName(component, "events", uniqueSuffix),
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambda/events", {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            "bash",
            "-c",
            "export npm_config_cache=/tmp/.npm && npm install --omit=dev && cp -r . /asset-output",
          ],
        },
      }),
      role: lambdaRole,
      environment: { FIREHOSE_STREAM_NAME: eventsFirehoseStreamName },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logGroup: eventsLogGroup,
    });

    const ordersLogGroup = new logs.LogGroup(this, "OrdersLogGroup", {
      logGroupName: makeLambdaLogGroupName(component, "orders", uniqueSuffix),
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.ordersLambda = new lambda.Function(this, "OrdersLambda", {
      functionName: makeName(component, "orders", uniqueSuffix),
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("./lambda/orders", {
        bundling: {
          image: lambda.Runtime.NODEJS_22_X.bundlingImage,
          command: [
            "bash",
            "-c",
            "export npm_config_cache=/tmp/.npm && npm install --omit=dev && cp -r . /asset-output",
          ],
        },
      }),
      role: lambdaRole,
      environment: { FIREHOSE_STREAM_NAME: ordersFirehoseStreamName },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logGroup: ordersLogGroup,
    });
  }
}
