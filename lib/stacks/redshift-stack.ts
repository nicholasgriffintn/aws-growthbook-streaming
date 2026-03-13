import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as redshiftserverless from "aws-cdk-lib/aws-redshiftserverless";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { BaseStackProps } from "../shared/types";

export interface RedshiftStackProps extends BaseStackProps {
  vpc: ec2.Vpc;
}

export class RedshiftStack extends cdk.Stack {
  public readonly adminSecret: secretsmanager.Secret;
  public readonly growthbookUserSecret: secretsmanager.Secret;
  public readonly workgroupEndpointAddress: string;
  public readonly workgroupEndpointPort: string;
  public readonly databaseName: string;
  public readonly namespaceName: string;
  public readonly workgroupName: string;
  public readonly securityGroup: ec2.SecurityGroup;
  public readonly redshiftRole: iam.Role;

  constructor(scope: Construct, id: string, props: RedshiftStackProps) {
    super(scope, id, props);

    const { component = "growthbook-platform", vpc } = props;

    this.databaseName = "analytics";
    this.namespaceName = `${component}-ns`;
    this.workgroupName = `${component}-wg`;

    this.adminSecret = new secretsmanager.Secret(this, "RedshiftAdminSecret", {
      secretName: `/${component}/redshift/admin`,
      description: "Redshift Serverless admin credentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "admin" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 16,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.growthbookUserSecret = new secretsmanager.Secret(
      this,
      "GrowthbookUserSecret",
      {
        secretName: `/${component}/redshift/growthbook-user`,
        description: "GrowthBook read-only Redshift user credentials",
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "growthbook_user" }),
          generateStringKey: "password",
          excludePunctuation: true,
          passwordLength: 16,
        },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    this.redshiftRole = new iam.Role(this, "RedshiftS3Role", {
      assumedBy: new iam.ServicePrincipal("redshift.amazonaws.com"),
      description: "Allows Redshift Serverless to COPY from S3",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3ReadOnlyAccess"),
      ],
    });
    this.redshiftRole.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    const namespace = new redshiftserverless.CfnNamespace(this, "Namespace", {
      namespaceName: this.namespaceName,
      dbName: this.databaseName,
      adminUsername: "admin",
      adminUserPassword: this.adminSecret
        .secretValueFromJson("password")
        .unsafeUnwrap(),
      iamRoles: [this.redshiftRole.roleArn],
    });
    namespace.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    this.securityGroup = new ec2.SecurityGroup(this, "RedshiftSg", {
      vpc,
      description: "Security group for Redshift Serverless workgroup",
      allowAllOutbound: true,
    });

    this.securityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5439),
      "VPC access",
    );

    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5439),
      "Kinesis Firehose - required for JDBC delivery from managed service",
    );

    if (vpc.publicSubnets.length === 0) {
      throw new Error(
        'Redshift workgroup requires public subnets for Firehose connectivity.',
      );
    }

    const workgroup = new redshiftserverless.CfnWorkgroup(this, 'Workgroup', {
      workgroupName: this.workgroupName,
      namespaceName: namespace.namespaceName,
      baseCapacity: 8,
      enhancedVpcRouting: false,
      port: 5439,
      publiclyAccessible: true,
      subnetIds: vpc.publicSubnets.map((s) => s.subnetId),
      securityGroupIds: [this.securityGroup.securityGroupId],
    });
    workgroup.addDependency(namespace);
    workgroup.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    this.workgroupEndpointAddress = workgroup.attrWorkgroupEndpointAddress;
    this.workgroupEndpointPort = "5439";

    new cdk.CfnOutput(this, "WorkgroupEndpoint", {
      value: this.workgroupEndpointAddress,
      description: "Redshift Serverless workgroup endpoint address",
      exportName: `${cdk.Stack.of(this).stackName}-WorkgroupEndpoint`,
    });

    new cdk.CfnOutput(this, "DatabaseName", {
      value: this.databaseName,
    });

    new cdk.CfnOutput(this, "AdminSecretArn", {
      value: this.adminSecret.secretArn,
      exportName: `${cdk.Stack.of(this).stackName}-AdminSecretArn`,
    });

    new cdk.CfnOutput(this, "GrowthbookUserSecretArn", {
      value: this.growthbookUserSecret.secretArn,
      description:
        "Secrets Manager ARN for the growthbook_user Redshift credentials",
      exportName: `${cdk.Stack.of(this).stackName}-GrowthbookUserSecretArn`,
    });
  }
}
