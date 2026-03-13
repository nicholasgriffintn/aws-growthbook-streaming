import * as cdk from "aws-cdk-lib";
import * as docdb from "aws-cdk-lib/aws-docdb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import type { Construct } from "constructs";

import { makeUniqueSuffix } from "../shared/naming";
import type { BaseStackProps } from "../shared/types";

export interface DocumentDbStackProps extends BaseStackProps {
  vpc: ec2.IVpc;
  kmsKey: kms.IKey;
}

export class DocumentDbStack extends cdk.Stack {
  public readonly cluster: docdb.DatabaseCluster;

  constructor(scope: Construct, id: string, props: DocumentDbStackProps) {
    super(scope, id, props);

    const { component = "data-platform" } = props;
    const uniqueSuffix = makeUniqueSuffix(this);

    const parameterGroup = new docdb.ClusterParameterGroup(
      this,
      "ParameterGroup",
      {
        family: "docdb5.0",
        description: "GrowthBook DocumentDB cluster parameter group",
        parameters: { tls: "enabled" },
      },
    );

    const docdbSg = new ec2.SecurityGroup(this, "DocDbSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: false,
      description: "Security group for GrowthBook DocumentDB",
    });
    docdbSg.addIngressRule(
      ec2.Peer.ipv4(props.vpc.vpcCidrBlock),
      ec2.Port.tcp(27017),
    );

    this.cluster = new docdb.DatabaseCluster(this, "DocDbCluster", {
      dbClusterName: `${component}-docdb-${uniqueSuffix}`,
      masterUser: {
        username: "docdbAdmin",
        secretName: `${component}/docdb-master-credentials`,
      },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM,
      ),
      instances: 1,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: docdbSg,
      storageEncrypted: true,
      kmsKey: props.kmsKey,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      parameterGroup,
    });

    new cdk.CfnOutput(this, "ClusterEndpoint", {
      value: this.cluster.clusterEndpoint.hostname,
      description: "DocumentDB cluster endpoint",
    });
  }
}
