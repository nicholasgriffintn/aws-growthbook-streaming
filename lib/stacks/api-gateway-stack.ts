import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";

import { makeUniqueSuffix, makeName } from "../shared/naming";
import type { BaseStackProps } from "../shared/types";

export interface ApiGatewayStackProps extends BaseStackProps {
  eventsLambda: lambda.Function;
  ordersLambda: lambda.Function;
  corsOrigin?: string;
}

export class ApiGatewayStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiKeyId: string;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    const {
      component = "growthbook-platform",
      eventsLambda,
      ordersLambda,
      corsOrigin,
    } = props;
    const uniqueSuffix = makeUniqueSuffix(this);

    const allowOrigins = corsOrigin
      ? [corsOrigin]
      : apigateway.Cors.ALL_ORIGINS;
    const originHeader = corsOrigin ? `'${corsOrigin}'` : "'*'";

    this.api = new apigateway.RestApi(this, "Api", {
      restApiName: makeName(component, "api", uniqueSuffix),
      description: "API for GrowthBook streaming analytics fact tables",
      defaultCorsPreflightOptions: {
        allowOrigins,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization", "x-api-key"],
      },
      deployOptions: {
        stageName: "prod",
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
    });

    const apiKey = this.api.addApiKey("ApiKey", {
      apiKeyName: makeName(component, "api-key", uniqueSuffix),
      description: "API key for streaming events and orders endpoints",
    });
    this.apiKeyId = apiKey.keyId;

    const usagePlan = this.api.addUsagePlan("UsagePlan", {
      name: makeName(component, "usage-plan", uniqueSuffix),
      description: "Default usage plan with rate limiting",
      throttle: {
        rateLimit: 100,
        burstLimit: 200,
      },
      quota: {
        limit: 100_000,
        period: apigateway.Period.DAY,
      },
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: this.api.deploymentStage });

    this.api.addGatewayResponse("Default4XX", {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": originHeader,
        "Access-Control-Allow-Headers": "'*'",
      },
    });

    this.api.addGatewayResponse("Default5XX", {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": originHeader,
        "Access-Control-Allow-Headers": "'*'",
      },
    });

    const eventsResource = this.api.root.addResource("events");
    eventsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(eventsLambda),
      { apiKeyRequired: true },
    );

    const ordersResource = this.api.root.addResource("orders");
    ordersResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(ordersLambda),
      { apiKeyRequired: true },
    );

    const healthResource = this.api.root.addResource("health");
    healthResource.addMethod(
      "GET",
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin":
                originHeader,
            },
            responseTemplates: {
              "application/json": JSON.stringify({ status: "healthy" }),
            },
          },
        ],
        requestTemplates: { "application/json": '{"statusCode": 200}' },
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      }),
      {
        methodResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": true,
            },
          },
        ],
      },
    );

    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.api.url,
      exportName: `${cdk.Stack.of(this).stackName}-ApiUrl`,
    });

    new cdk.CfnOutput(this, "ApiKeyId", {
      value: apiKey.keyId,
      description:
        "Retrieve the key value with: aws apigateway get-api-key --api-key-id VALUE --include-value --query value --output text",
    });
  }
}
