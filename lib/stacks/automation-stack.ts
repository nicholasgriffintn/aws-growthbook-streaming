import * as cdk from 'aws-cdk-lib';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import path from 'path';
import type { Construct } from 'constructs';

import type { BaseStackProps } from '../shared/types';

export interface AutomationStackProps extends BaseStackProps {
  encryptionKeyParameterArn: string;
  encryptionKeyParameterName: string;
  jwtParameterArn: string;
  jwtParameterName: string;
  docdbSecretArn: string;
  docdbEndpoint: string;
  mongoDbParameterArn: string;
  mongoDbParameterName: string;
  redshiftWorkgroupName: string;
  redshiftDatabase: string;
  redshiftAdminSecretArn: string;
  redshiftUserSecretArn: string;
}

export class AutomationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AutomationStackProps) {
    super(scope, id, props);

    const {
      encryptionKeyParameterArn,
      encryptionKeyParameterName,
      jwtParameterArn,
      jwtParameterName,
      docdbSecretArn,
      docdbEndpoint,
      mongoDbParameterArn,
      mongoDbParameterName,
      redshiftWorkgroupName,
      redshiftDatabase,
      redshiftAdminSecretArn,
      redshiftUserSecretArn,
    } = props;

    // -------------------------------------------------------------------------
    // Auto-generate ENCRYPTION_KEY and JWT_SECRET in SSM
    // -------------------------------------------------------------------------
    const initSecretsFn = new lambda.Function(this, 'InitSecretsFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../lambda/custom-resources/init-secrets'),
      ),
      timeout: cdk.Duration.seconds(30),
      description: 'Generates random ENCRYPTION_KEY and JWT_SECRET in SSM',
    });
    initSecretsFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        resources: [encryptionKeyParameterArn, jwtParameterArn],
      }),
    );
    const initSecretsProvider = new cr.Provider(this, 'InitSecretsProvider', {
      onEventHandler: initSecretsFn,
    });
    new cdk.CustomResource(this, 'InitSecrets', {
      serviceToken: initSecretsProvider.serviceToken,
      properties: {
        parameterNames: [encryptionKeyParameterName, jwtParameterName],
      },
    });

    // -------------------------------------------------------------------------
    // Build the MongoDB connection string from the DocDB secret and write it
    // to SSM.
    // -------------------------------------------------------------------------
    const mongoInitFn = new lambda.Function(this, 'MongoInitFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../lambda/custom-resources/mongo-init'),
      ),
      timeout: cdk.Duration.seconds(60),
      description: 'Sets MongoDB connection string in SSM',
    });
    mongoInitFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [docdbSecretArn],
      }),
    );
    mongoInitFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        resources: [mongoDbParameterArn],
      }),
    );
    const mongoInitProvider = new cr.Provider(this, 'MongoInitProvider', {
      onEventHandler: mongoInitFn,
    });
    new cdk.CustomResource(this, 'MongoInit', {
      serviceToken: mongoInitProvider.serviceToken,
      properties: {
        secretArn: docdbSecretArn,
        endpoint: docdbEndpoint,
        ssmParam: mongoDbParameterName,
      },
    });

    // -------------------------------------------------------------------------
    // Create Redshift schema, fact tables, derived views, and read-only user.
    // -------------------------------------------------------------------------
    const redshiftInitFn = new lambda.Function(this, 'RedshiftInitFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../lambda/custom-resources/redshift-init'),
      ),
      timeout: cdk.Duration.minutes(2),
      description:
        'Creates experimentation schema, fact tables, derived views, and growthbook_user in Redshift',
    });
    redshiftInitFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'redshift-data:BatchExecuteStatement',
          'redshift-data:DescribeStatement',
        ],
        resources: ['*'],
      }),
    );
    redshiftInitFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [redshiftAdminSecretArn, redshiftUserSecretArn],
      }),
    );
    const redshiftInitProvider = new cr.Provider(this, 'RedshiftInitProvider', {
      onEventHandler: redshiftInitFn,
    });
    new cdk.CustomResource(this, 'RedshiftInit', {
      serviceToken: redshiftInitProvider.serviceToken,
      properties: {
        workgroupName: redshiftWorkgroupName,
        database: redshiftDatabase,
        adminSecretArn: redshiftAdminSecretArn,
        userSecretArn: redshiftUserSecretArn,
      },
    });
  }
}
