import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import type * as lambda from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";

import { makeUniqueSuffix, makeName } from "../shared/naming";
import type { BaseStackProps } from "../shared/types";

export interface ApiGatewayStackProps extends BaseStackProps {
  eventsLambda: lambda.Function;
  ordersLambda: lambda.Function;
}

export class ApiGatewayStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiGatewayStackProps) {
    super(scope, id, props);

    const {
      component = "growthbook-platform",
      eventsLambda,
      ordersLambda,
    } = props;
    const uniqueSuffix = makeUniqueSuffix(this);

    this.api = new apigateway.RestApi(this, "Api", {
      restApiName: makeName(component, "api", uniqueSuffix),
      description: "API for GrowthBook streaming analytics fact tables",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
      },
      deployOptions: {
        stageName: "prod",
        metricsEnabled: true,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
      },
    });

    this.api.addGatewayResponse("Default4XX", {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": "'*'",
        "Access-Control-Allow-Headers": "'*'",
      },
    });

    this.api.addGatewayResponse("Default5XX", {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": "'*'",
        "Access-Control-Allow-Headers": "'*'",
      },
    });

    const eventsResource = this.api.root.addResource("events");
    eventsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(eventsLambda),
    );

    const ordersResource = this.api.root.addResource("orders");
    ordersResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(ordersLambda),
    );

    const healthResource = this.api.root.addResource("health");
    healthResource.addMethod(
      "GET",
      new apigateway.MockIntegration({
        integrationResponses: [
          {
            statusCode: "200",
            responseParameters: {
              "method.response.header.Access-Control-Allow-Origin": "'*'",
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
  }
}
