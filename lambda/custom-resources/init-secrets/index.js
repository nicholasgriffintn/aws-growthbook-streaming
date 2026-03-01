const {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} = require('@aws-sdk/client-ssm');
const { randomBytes } = require('crypto');

const ssm = new SSMClient({});

exports.handler = async (event) => {
  if (event.RequestType === 'Delete') {
    return { PhysicalResourceId: event.PhysicalResourceId ?? 'init-secrets' };
  }

  const { parameterNames } = event.ResourceProperties;

  for (const name of parameterNames) {
    try {
      const current = await ssm.send(new GetParameterCommand({ Name: name }));
      if (current.Parameter.Value !== 'REPLACE_ME') continue;
    } catch {}
    await ssm.send(
      new PutParameterCommand({
        Name: name,
        Value: randomBytes(32).toString('hex'),
        Type: 'String',
        Overwrite: true,
      }),
    );
  }

  return { PhysicalResourceId: 'init-secrets' };
};
