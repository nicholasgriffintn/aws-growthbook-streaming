import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { makeUniqueSuffix, makeName } from "../shared/naming";
import type { BaseStackProps } from "../shared/types";

export class StreamingStorageStack extends cdk.Stack {
  public readonly firehoseBackupBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);

    const { component = "growthbook-platform" } = props;
    const uniqueSuffix = makeUniqueSuffix(this);

    this.firehoseBackupBucket = new s3.Bucket(this, "FirehoseBackupBucket", {
      bucketName: makeName(component, "firehose-backup", uniqueSuffix),
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      lifecycleRules: [
        {
          id: "ExpireAfter90Days",
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new cdk.CfnOutput(this, "FirehoseBackupBucketName", {
      value: this.firehoseBackupBucket.bucketName,
      description: "Firehose backup/staging bucket name",
      exportName: `${cdk.Stack.of(this).stackName}-FirehoseBackupBucketName`,
    });
  }
}
