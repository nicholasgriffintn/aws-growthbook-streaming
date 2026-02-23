import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { VpcConstruct } from '../constructs/network/vpc';
import { makeUniqueSuffix } from '../shared/naming';
import type { BaseStackProps } from '../shared/types';

export interface CoreNetworkStackProps extends BaseStackProps {}

export class CoreNetworkStack extends cdk.Stack {
  public readonly vpc: VpcConstruct;
  public readonly component: string;

  constructor(scope: Construct, id: string, props: CoreNetworkStackProps = {}) {
    super(scope, id, props);

    const { component = 'data-platform' } = props;
    this.component = component;

    const uniqueSuffix = makeUniqueSuffix(this);

    this.vpc = new VpcConstruct(this, 'Vpc', {
      component,
      uniqueSuffix,
    });
  }
}
