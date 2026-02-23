import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface VpcConstructProps {
  /**
   * Name for the component.
   * @default 'data-platform'
   */
  component?: string;

  /**
   * Unique suffix for resource naming
   */
  uniqueSuffix: string;

  /**
   * Maximum number of availability zones
   * @default 2
   */
  maxAzs?: number;
}

export class VpcConstruct extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: VpcConstructProps) {
    super(scope, id);

    const { component = 'data-platform', uniqueSuffix, maxAzs = 3 } = props;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${component}-vpc-${uniqueSuffix}`,
      maxAzs,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    this.vpc.addInterfaceEndpoint('AthenaEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ATHENA,
    });

    this.vpc.addInterfaceEndpoint('CloudWatchEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
    });

    this.vpc.addInterfaceEndpoint('CloudWatchLogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });

    this.vpc.addInterfaceEndpoint('XRayEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.XRAY,
    });

    this.vpc.addInterfaceEndpoint('KinesisFirehoseEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.KINESIS_FIREHOSE,
    });

    this.vpc.addInterfaceEndpoint('StsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.STS,
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID for the data platform',
      exportName: `${cdk.Stack.of(this).stackName}-VpcId`,
    });

    new cdk.CfnOutput(this, 'VpcCidrBlock', {
      value: this.vpc.vpcCidrBlock,
      description: 'VPC CIDR block',
      exportName: `${cdk.Stack.of(this).stackName}-VpcCidrBlock`,
    });
  }
}