import * as cdk from "aws-cdk-lib";
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
      redshiftDatabaseName,
      redshiftAdminSecret,
    } = props;

    const uniqueSuffix = makeUniqueSuffix(this);

    const firehoseIam = new FirehoseIamConstruct(this, "FirehoseIam", {
      firehoseBackupBucketArn: firehoseBackupBucket.bucketArn,
      adminSecret: redshiftAdminSecret,
    });

    const jdbcUrl = `jdbc:redshift://${redshiftEndpointAddress}:5439/${redshiftDatabaseName}`;
    const adminPassword = redshiftAdminSecret
      .secretValueFromJson("password")
      .unsafeUnwrap();

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
          username: "admin",
          password: adminPassword,
          roleArn: firehoseIam.firehoseRole.roleArn,
          copyCommand: {
            dataTableName: "experimentation.fact_events",
            dataTableColumns:
              "event_id,user_id,anonymous_id,timestamp,event_type,page_path,session_id,device_type,properties",
            copyOptions:
              "JSON 'auto ignorecase' TIMEFORMAT 'auto' TRUNCATECOLUMNS",
          },
          s3Configuration: {
            bucketArn: firehoseBackupBucket.bucketArn,
            roleArn: firehoseIam.firehoseRole.roleArn,
            prefix: "fact-events/",
            errorOutputPrefix: "fact-events-errors/",
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
          username: "admin",
          password: adminPassword,
          roleArn: firehoseIam.firehoseRole.roleArn,
          copyCommand: {
            dataTableName: "experimentation.fact_orders",
            dataTableColumns:
              "order_id,user_id,anonymous_id,timestamp,amount,currency,device_type,coupon_code",
            copyOptions:
              "JSON 'auto ignorecase' TIMEFORMAT 'auto' TRUNCATECOLUMNS",
          },
          s3Configuration: {
            bucketArn: firehoseBackupBucket.bucketArn,
            roleArn: firehoseIam.firehoseRole.roleArn,
            prefix: "fact-orders/",
            errorOutputPrefix: "fact-orders-errors/",
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

    new cdk.CfnOutput(this, "EventsFirehoseStreamName", {
      value: this.eventsFirehoseStreamName,
    });
    new cdk.CfnOutput(this, "OrdersFirehoseStreamName", {
      value: this.ordersFirehoseStreamName,
    });
  }
}
