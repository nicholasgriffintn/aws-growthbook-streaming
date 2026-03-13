import * as cdk from "aws-cdk-lib";
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

import { makeUniqueSuffix, makeName } from "../shared/naming";
import { FirehoseIamConstruct } from "../constructs/streaming/firehose-iam";
import type { BaseStackProps } from "../shared/types";

export interface FirehoseStackProps extends BaseStackProps {
  firehoseBackupBucket: s3.Bucket;
  redshiftEndpointAddress: string;
  redshiftEndpointPort: string;
  redshiftDatabaseName: string;
  redshiftAdminSecret: secretsmanager.Secret;
}

export class FirehoseStack extends cdk.Stack {
  public readonly eventsFirehoseStreamName: string;
  public readonly ordersFirehoseStreamName: string;

  constructor(scope: Construct, id: string, props: FirehoseStackProps) {
    super(scope, id, props);

    const {
      component = "growthbook-platform",
      firehoseBackupBucket,
      redshiftEndpointAddress,
      redshiftEndpointPort,
      redshiftDatabaseName,
      redshiftAdminSecret,
    } = props;

    const uniqueSuffix = makeUniqueSuffix(this);

    const firehoseIam = new FirehoseIamConstruct(this, "FirehoseIam", {
      firehoseBackupBucketArn: firehoseBackupBucket.bucketArn,
      adminSecret: redshiftAdminSecret,
    });

    const jdbcUrl = `jdbc:redshift://${redshiftEndpointAddress}:${redshiftEndpointPort}/${redshiftDatabaseName}`;

    const eventsLogGroup = new logs.LogGroup(this, "EventsFirehoseLogs", {
      logGroupName: `/aws/kinesisfirehose/${component}-events-${uniqueSuffix}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const eventsLogStream = new logs.LogStream(
      this,
      "EventsFirehoseLogStream",
      {
        logGroup: eventsLogGroup,
        logStreamName: "RedshiftDelivery",
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    this.eventsFirehoseStreamName = makeName(component, "events", uniqueSuffix);

    const eventsStream = new firehose.CfnDeliveryStream(
      this,
      "EventsFirehose",
      {
        deliveryStreamName: this.eventsFirehoseStreamName,
        deliveryStreamType: "DirectPut",
        redshiftDestinationConfiguration: {
          clusterJdbcurl: jdbcUrl,
          roleArn: firehoseIam.firehoseRole.roleArn,
          secretsManagerConfiguration: {
            enabled: true,
            roleArn: firehoseIam.firehoseRole.roleArn,
            secretArn: redshiftAdminSecret.secretArn,
          },
          copyCommand: {
            dataTableName: "experimentation.fact_events",
            dataTableColumns:
              "event_id,user_id,anonymous_id,timestamp,event_type,page_path,session_id,device_type,properties,page_category,country,referrer_domain,logged_in,experiment_id,variation_id,feature_key,feature_value",
            copyOptions:
              "JSON 'auto ignorecase' TIMEFORMAT 'auto' TRUNCATECOLUMNS",
          },
          s3Configuration: {
            bucketArn: firehoseBackupBucket.bucketArn,
            roleArn: firehoseIam.firehoseRole.roleArn,
            prefix: "fact-events/",
            compressionFormat: "UNCOMPRESSED",
            bufferingHints: { intervalInSeconds: 60, sizeInMBs: 1 },
          },
          cloudWatchLoggingOptions: {
            enabled: true,
            logGroupName: eventsLogGroup.logGroupName,
            logStreamName: eventsLogStream.logStreamName,
          },
        },
      },
    );
    eventsStream.node.addDependency(eventsLogStream);
    eventsStream.node.addDependency(firehoseIam.firehoseRole);
    eventsStream.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const ordersLogGroup = new logs.LogGroup(this, "OrdersFirehoseLogs", {
      logGroupName: `/aws/kinesisfirehose/${component}-orders-${uniqueSuffix}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const ordersLogStream = new logs.LogStream(
      this,
      "OrdersFirehoseLogStream",
      {
        logGroup: ordersLogGroup,
        logStreamName: "RedshiftDelivery",
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    this.ordersFirehoseStreamName = makeName(component, "orders", uniqueSuffix);

    const ordersStream = new firehose.CfnDeliveryStream(
      this,
      "OrdersFirehose",
      {
        deliveryStreamName: this.ordersFirehoseStreamName,
        deliveryStreamType: "DirectPut",
        redshiftDestinationConfiguration: {
          clusterJdbcurl: jdbcUrl,
          roleArn: firehoseIam.firehoseRole.roleArn,
          secretsManagerConfiguration: {
            enabled: true,
            roleArn: firehoseIam.firehoseRole.roleArn,
            secretArn: redshiftAdminSecret.secretArn,
          },
          copyCommand: {
            dataTableName: "experimentation.fact_orders",
            dataTableColumns:
              "order_id,user_id,anonymous_id,session_id,timestamp,amount,currency,device_type,country,referrer_domain,logged_in,coupon_code,order_status,properties",
            copyOptions:
              "JSON 'auto ignorecase' TIMEFORMAT 'auto' TRUNCATECOLUMNS",
          },
          s3Configuration: {
            bucketArn: firehoseBackupBucket.bucketArn,
            roleArn: firehoseIam.firehoseRole.roleArn,
            prefix: "fact-orders/",
            compressionFormat: "UNCOMPRESSED",
            bufferingHints: { intervalInSeconds: 60, sizeInMBs: 1 },
          },
          cloudWatchLoggingOptions: {
            enabled: true,
            logGroupName: ordersLogGroup.logGroupName,
            logStreamName: ordersLogStream.logStreamName,
          },
        },
      },
    );
    ordersStream.node.addDependency(ordersLogStream);
    ordersStream.node.addDependency(firehoseIam.firehoseRole);
    ordersStream.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    for (const [id, streamName] of [
      ['Events', this.eventsFirehoseStreamName],
      ['Orders', this.ordersFirehoseStreamName],
    ] as const) {
      new cloudwatch.Alarm(this, `${id}DeliveryFreshnessAlarm`, {
        alarmName: `${streamName}-delivery-stalled`,
        alarmDescription: `${id} Firehose delivery to Redshift is stalled (oldest buffered record > 5 min)`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Firehose',
          metricName: 'DeliveryToRedshift.DataFreshness',
          dimensionsMap: { DeliveryStreamName: streamName },
          statistic: 'Maximum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 300,
        evaluationPeriods: 2,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }

    new cdk.CfnOutput(this, "EventsFirehoseStreamName", {
      value: this.eventsFirehoseStreamName,
    });
    new cdk.CfnOutput(this, "OrdersFirehoseStreamName", {
      value: this.ordersFirehoseStreamName,
    });
  }
}
