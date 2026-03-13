import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";

export interface FrontendConstructProps {
  component?: string;
  uniqueSuffix: string;
  apiUrl: string;
  domainName?: string;
  certificateArn?: string;
  apiKey?: string;
  growthbookAppUrl?: string;
}

export class FrontendConstruct extends Construct {
  public readonly websiteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly websiteUrl: string;

  constructor(scope: Construct, id: string, props: FrontendConstructProps) {
    super(scope, id);

    const {
      component = "growthbook-platform",
      uniqueSuffix,
      apiUrl,
      domainName,
      certificateArn,
      apiKey,
      growthbookAppUrl,
    } = props;

    this.websiteBucket = new s3.Bucket(this, "WebsiteBucket", {
      bucketName: `${component}-frontend-${uniqueSuffix}`,
      websiteIndexDocument: "index.html",
      websiteErrorDocument: "error.html",
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(
          this.websiteBucket,
        ),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.seconds(0),
        },
      ],
      domainNames: domainName ? [domainName] : undefined,
      certificate: certificateArn
        ? certificatemanager.Certificate.fromCertificateArn(
            this,
            "Certificate",
            certificateArn,
          )
        : undefined,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2,
    });

    this.websiteBucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [
          new cdk.aws_iam.ServicePrincipal("cloudfront.amazonaws.com"),
        ],
        actions: ["s3:GetObject"],
        resources: [`${this.websiteBucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${this.distribution.distributionId}`,
          },
        },
      }),
    );

    const configContent = {
      api: {
        baseUrl: apiUrl,
        eventsEndpoint: `${apiUrl}events`,
        ordersEndpoint: `${apiUrl}orders`,
        healthEndpoint: `${apiUrl}health`,
        ...(apiKey ? { apiKey } : {}),
      },
      growthbook: {
        ...(growthbookAppUrl ? { appUrl: growthbookAppUrl } : {}),
        assignmentView: "experimentation.experiment_assignments",
        featureUsageView: "experimentation.feature_usage",
        sessionMetricsView: "experimentation.session_metrics",
        checkoutFunnelView: "experimentation.checkout_funnel",
        userDayMetricsView: "experimentation.user_day_metrics",
        demoExperiment: {
          key: "checkout-layout-aa",
          featureKey: "checkout-layout",
          variations: [
            {
              id: "0",
              label: "classic",
              value: "classic",
              conversionMultiplier: 1,
            },
            {
              id: "1",
              label: "modern",
              value: "modern",
              conversionMultiplier: 1,
            },
          ],
        },
      },
    };

    new s3deploy.BucketDeployment(this, "WebsiteDeployment", {
      sources: [
        s3deploy.Source.asset("./frontend"),
        s3deploy.Source.jsonData("config.json", configContent),
      ],
      destinationBucket: this.websiteBucket,
      distribution: this.distribution,
      distributionPaths: ["/*"],
    });

    this.websiteUrl = domainName
      ? `https://${domainName}`
      : `https://${this.distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, "WebsiteUrl", {
      value: this.websiteUrl,
      exportName: `${cdk.Stack.of(this).stackName}-WebsiteUrl`,
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: this.distribution.distributionId,
      exportName: `${cdk.Stack.of(this).stackName}-CloudFrontDistributionId`,
    });
  }
}
