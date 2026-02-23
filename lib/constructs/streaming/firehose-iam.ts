import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface FirehoseIamConstructProps {
  firehoseBackupBucketArn: string;
  adminSecret: secretsmanager.Secret;
}

export class FirehoseIamConstruct extends Construct {
  public readonly firehoseRole: iam.Role;

  constructor(scope: Construct, id: string, props: FirehoseIamConstructProps) {
    super(scope, id);

    const { firehoseBackupBucketArn, adminSecret } = props;
    const stack = cdk.Stack.of(this);

    this.firehoseRole = new iam.Role(this, "FirehoseRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
      description: "Allows Firehose to stage to S3 and COPY to Redshift",
    });

    this.firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "S3StagingPermissions",
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
        ],
        resources: [firehoseBackupBucketArn, `${firehoseBackupBucketArn}/*`],
      }),
    );

    this.firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "CloudWatchLogsPermission",
        effect: iam.Effect.ALLOW,
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: [
          `arn:${stack.partition}:logs:${stack.region}:${stack.account}:log-group:/aws/kinesisfirehose/*`,
        ],
      }),
    );

    adminSecret.grantRead(this.firehoseRole);
    this.firehoseRole.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
  }
}
