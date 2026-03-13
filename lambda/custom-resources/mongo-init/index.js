const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} = require('@aws-sdk/client-ssm');

function buildConnectionString({ username, password, endpoint }) {
  return (
    'mongodb://' +
    encodeURIComponent(username) +
    ':' +
    encodeURIComponent(password) +
    '@' +
    endpoint +
    ':27017/growthbook?tls=true' +
    '&tlsCAFile=/usr/local/src/app/global-bundle.pem' +
    '&replicaSet=rs0&retryWrites=false' +
    '&authSource=admin'
  );
}

exports.handler = async (event) => {
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: event.PhysicalResourceId ?? 'mongo-init' };
  }

  const { secretArn, endpoint, ssmParam } = event.ResourceProperties;

  const ssm = new SSMClient({});
  let currentValue = '';
  try {
    const current = await ssm.send(new GetParameterCommand({ Name: ssmParam }));
    currentValue = current.Parameter?.Value ?? '';
  } catch (error) {
    if (error?.name !== 'ParameterNotFound') {
      throw error;
    }
  }

  const sm = new SecretsManagerClient({});
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );

  if (!SecretString) {
    throw new Error('DocumentDB secret value is empty');
  }

  const secret = JSON.parse(SecretString);
  if (!secret.username || !secret.password) {
    throw new Error('DocumentDB secret missing username or password');
  }

  const connStr = buildConnectionString({
    username: secret.username,
    password: secret.password,
    endpoint,
  });

  if (currentValue !== connStr) {
    await ssm.send(
      new PutParameterCommand({
        Name: ssmParam,
        Value: connStr,
        Type: 'String',
        Overwrite: true,
      }),
    );
  }

  return { PhysicalResourceId: 'mongo-init' };
};
