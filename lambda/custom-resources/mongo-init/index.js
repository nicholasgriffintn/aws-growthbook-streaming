const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} = require('@aws-sdk/client-ssm');
const { ECSClient, UpdateServiceCommand } = require('@aws-sdk/client-ecs');

exports.handler = async (event) => {
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: event.PhysicalResourceId ?? 'mongo-init' };
  }

  const { secretArn, endpoint, ssmParam, clusterArn, serviceName } =
    event.ResourceProperties;

  const ssm = new SSMClient({});
  let needsWrite = true;
  try {
    const current = await ssm.send(new GetParameterCommand({ Name: ssmParam }));
    needsWrite = current.Parameter.Value === 'REPLACE_ME';
  } catch {}

  if (needsWrite) {
    const sm = new SecretsManagerClient({});
    const { SecretString } = await sm.send(
      new GetSecretValueCommand({ SecretId: secretArn }),
    );
    const secret = JSON.parse(SecretString);
    const user = secret.username;
    const pass = encodeURIComponent(secret.password);
    const connStr =
      'mongodb://' +
      user +
      ':' +
      pass +
      '@' +
      endpoint +
      ':27017/growthbook?tls=true' +
      '&tlsCAFile=/etc/pki/tls/certs/ca-bundle.crt' +
      '&replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false';

    await ssm.send(
      new PutParameterCommand({
        Name: ssmParam,
        Value: connStr,
        Type: 'String',
        Overwrite: true,
      }),
    );
  }

  if (needsWrite) {
    const ecs = new ECSClient({});
    await ecs.send(
      new UpdateServiceCommand({
        cluster: clusterArn,
        service: serviceName,
        forceNewDeployment: true,
      }),
    );
  }

  return { PhysicalResourceId: 'mongo-init' };
};
