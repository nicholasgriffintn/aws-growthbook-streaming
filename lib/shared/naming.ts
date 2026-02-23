import * as cdk from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

export function makeUniqueSuffix(scope: IConstruct): string {
  return cdk.Names.uniqueId(scope).slice(-10).toLowerCase();
}

export function makeName(
  component: string,
  resource: string,
  suffix: string,
): string {
  return `${component}-${resource}-${suffix}`;
}

export function makeLambdaLogGroupName(
  component: string,
  resource: string,
  suffix: string,
): string {
  return `/aws/lambda/${component}-${resource}-${suffix}`;
}
