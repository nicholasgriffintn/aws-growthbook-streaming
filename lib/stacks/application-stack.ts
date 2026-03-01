import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import type { BaseStackProps } from "../shared/types";

export interface ApplicationStackProps extends BaseStackProps {
  vpc: ec2.IVpc;
  ecsTaskRole: iam.IRole;
  ecsRepository: ecr.IRepository;
  domain: string;
  mongoDBStringParameter: ssm.IStringParameter;
  encryptionKeyParameter: ssm.IStringParameter;
  jwtParameter: ssm.IStringParameter;
  emailUsernameParameter: ssm.IStringParameter;
  emailPasswordParameter: ssm.IStringParameter;
}

export class ApplicationStack extends cdk.Stack {
  public readonly ecsCluster: ecs.Cluster;
  public readonly ecsTaskSg: ec2.SecurityGroup;
  public readonly applicationLoadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    const { domain } = props;

    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: domain,
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: `growthbook.${domain}`,
      subjectAlternativeNames: [`growthbook-api.${domain}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: "/ecs/prod-growthbook-logs",
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.ecsCluster = new ecs.Cluster(this, "EcsCluster", {
      vpc: props.vpc,
      containerInsights: true,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TaskDefinition",
      {
        family: "prod-growthbook-taskDef",
        cpu: 256,
        memoryLimitMiB: 512,
        taskRole: props.ecsTaskRole,
        executionRole: props.ecsTaskRole,
      },
    );

    taskDefinition.addContainer("growthbook", {
      image: ecs.ContainerImage.fromEcrRepository(
        props.ecsRepository,
        "latest",
      ),
      portMappings: [
        { containerPort: 3000, protocol: ecs.Protocol.TCP },
        { containerPort: 3100, protocol: ecs.Protocol.TCP },
      ],
      environment: {
        API_HOST: `https://growthbook-api.${domain}`,
        APP_ORIGIN: `https://growthbook.${domain}`,
        NODE_ENV: "production",
        EMAIL_ENABLED: "true",
        EMAIL_HOST: `email-smtp.${this.region}.amazonaws.com`,
        EMAIL_PORT: "587",
        EMAIL_FROM: `no-reply@${domain}`,
      },
      secrets: {
        ENCRYPTION_KEY: ecs.Secret.fromSsmParameter(
          props.encryptionKeyParameter,
        ),
        JWT_SECRET: ecs.Secret.fromSsmParameter(props.jwtParameter),
        MONGODB_URI: ecs.Secret.fromSsmParameter(props.mongoDBStringParameter),
        EMAIL_HOST_USER: ecs.Secret.fromSsmParameter(
          props.emailUsernameParameter,
        ),
        EMAIL_HOST_PASSWORD: ecs.Secret.fromSsmParameter(
          props.emailPasswordParameter,
        ),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "ecs",
        logGroup,
      }),
    });

    const albSg = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: "Security group for GrowthBook ALB",
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));

    this.ecsTaskSg = new ec2.SecurityGroup(this, "EcsTaskSecurityGroup", {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: "Security group for GrowthBook ECS tasks",
    });
    this.ecsTaskSg.addIngressRule(albSg, ec2.Port.tcp(3000));
    this.ecsTaskSg.addIngressRule(albSg, ec2.Port.tcp(3100));

    this.applicationLoadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "Alb",
      {
        loadBalancerName: "prod-growthbook-appLB",
        vpc: props.vpc,
        internetFacing: true,
        securityGroup: albSg,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      },
    );

    const appTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "AppTargetGroup",
      {
        targetGroupName: "prod-growthbookApp-tg",
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        vpc: props.vpc,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          path: "/",
          healthyHttpCodes: "200",
        },
      },
    );

    const apiTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "ApiTargetGroup",
      {
        targetGroupName: "prod-growthbookApi-tg",
        port: 3100,
        protocol: elbv2.ApplicationProtocol.HTTP,
        vpc: props.vpc,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          path: "/api/health",
          healthyHttpCodes: "200",
        },
      },
    );

    this.applicationLoadBalancer.addListener("HttpListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });

    const httpsListener = this.applicationLoadBalancer.addListener(
      "HttpsListener",
      {
        port: 443,
        certificates: [certificate],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
        defaultTargetGroups: [appTargetGroup],
      },
    );

    httpsListener.addAction("ApiAction", {
      priority: 1,
      conditions: [
        elbv2.ListenerCondition.hostHeaders([`growthbook-api.${domain}`]),
      ],
      action: elbv2.ListenerAction.forward([apiTargetGroup]),
    });

    const ecsService = new ecs.FargateService(this, "EcsService", {
      serviceName: "growthbook",
      cluster: this.ecsCluster,
      taskDefinition,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.ecsTaskSg],
      circuitBreaker: { rollback: true },
    });

    const scaling = ecsService.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 4,
    });
    scaling.scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(120),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    appTargetGroup.addTarget(
      ecsService.loadBalancerTarget({
        containerName: "growthbook",
        containerPort: 3000,
      }),
    );

    apiTargetGroup.addTarget(
      ecsService.loadBalancerTarget({
        containerName: "growthbook",
        containerPort: 3100,
      }),
    );

    new route53.ARecord(this, "AppRecord", {
      zone: hostedZone,
      recordName: `growthbook.${domain}`,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(this.applicationLoadBalancer),
      ),
    });

    new route53.ARecord(this, "ApiRecord", {
      zone: hostedZone,
      recordName: `growthbook-api.${domain}`,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.LoadBalancerTarget(this.applicationLoadBalancer),
      ),
    });
  }
}
