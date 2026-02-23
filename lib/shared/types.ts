import type * as cdk from 'aws-cdk-lib';

export interface BaseProps {
  component: string;
  uniqueSuffix: string;
}

export interface BaseStackProps extends cdk.StackProps {
  component?: string;
}
