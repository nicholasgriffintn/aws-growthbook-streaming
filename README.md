# AWS Growthbook Platform

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Setup](#setup)
4. [Tear Down](#tear-down)
5. [Pricing](#pricing)

## Overview

This project is an investigation into using the GrowthBook experimentation platform on AWS.

It uses CDK to provision the services as described in the architecture below. This includes a full ECS Fargate setup with an Application Load Balancer, private DocumentDB cluster, and secure storage of secrets in SSM Parameter Store and KMS.

## Architecture

```mermaid
graph TD
    R53["Route 53\ngrowthbook.{domain}"]
    ALB["ALB\nHTTP:80 → redirect\nHTTPS:443"]
    APP["app target group\nport 3000"]
    API["api target group\nport 3100"]
    ECS["ECS Fargate\nprivate subnet"]
    DDB["DocumentDB\nprivate subnet · TLS · KMS encrypted"]

    R53 --> ALB
    ALB --> APP
    ALB --> API
    APP --> ECS
    API --> ECS
    ECS -->|":27017"| DDB
```

| Stack              | Purpose                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `CoreNetworkStack` | VPC, 3 AZs, public/private subnets, NAT gateway, VPC endpoints     |
| `SecretsStack`     | KMS key + SSM parameter stubs                                      |
| `IamStack`         | ECS task/execution role scoped to SSM parameters + KMS key         |
| `ECRStack`         | ECR repository for the GrowthBook image                            |
| `ApplicationStack` | ECS cluster, task definition, ALB, target groups, Route 53 records |
| `DocumentDbStack`  | DocumentDB cluster (TLS, KMS encrypted, deletion protection)       |

## Setup

### 1. Push the GrowthBook image to ECR

Deploy `ECRStack` first to create the repository, then push the image before deploying `ApplicationStack`.

```sh
pnpm cdk deploy ECRStack
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com
docker pull growthbook/growthbook:latest
docker tag growthbook/growthbook:latest ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com/growthbook:latest
docker push ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com/growthbook:latest
```

### 2. Deploy all stacks

```sh
pnpm cdk deploy --all --context domain=<REPLACE_WITH_DOMAIN>
```

### 3. Populate SSM parameters

After `SecretsStack` deploys, update the placeholder values:

```sh
aws ssm put-parameter --name "/growthbook/production/encryptionKey" --value "<REPLACE_WITH_ENCRYPTION_KEY>" --type String --overwrite
aws ssm put-parameter --name "/growthbook/production/jwt" --value "<REPLACE_WITH_JWT>" --type String --overwrite
aws ssm put-parameter --name "/growthbook/production/email/username" --value "<REPLACE_WITH_EMAIL_USERNAME>" --type String --overwrite
aws ssm put-parameter --name "/growthbook/production/email/password" --value "<REPLACE_WITH_EMAIL_PASSWORD>" --type String --overwrite
```

### 4. Update the MongoDB connection string

After `DocumentDbStack` deploys, copy the cluster endpoint from the CloudFormation output. The DocumentDB master password is in Secrets Manager under `growthbook-platform/docdb-master-credentials`.

```sh
aws ssm put-parameter \
  --name "/growthbook/production/documentdb/dbstring" \
  --value "mongodb://docdbAdmin:<REPLACE_WITH_DOCDB_PASSWORD>@CLUSTER_ENDPOINT:27017/growthbook?tls=true&tlsCAFile=/etc/pki/tls/certs/ca-bundle.crt&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false" \
  --type String --overwrite
```

Force a new deployment to pick up the updated parameter:

```sh
aws ecs update-service --cluster CLUSTER_NAME --service growthbook --force-new-deployment
```

Then wait for the deployment to finish before accessing the app at `https://growthbook.{domain}`.

## Tear Down

DocumentDB has deletion protection enabled — disable it first:

```sh
aws docdb modify-db-cluster --db-cluster-identifier CLUSTER_ID --no-deletion-protection
pnpm cdk destroy --all
```

The KMS key and ECR repository have `RemovalPolicy.RETAIN` and must be cleaned up manually.

You can delete the rest of the resources with:

```sh
pnpm cdk destroy --all
```

## Pricing

TODO
