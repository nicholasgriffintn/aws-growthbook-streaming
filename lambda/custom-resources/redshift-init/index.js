const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require('@aws-sdk/client-secrets-manager');
const {
  RedshiftDataClient,
  BatchExecuteStatementCommand,
  DescribeStatementCommand,
} = require('@aws-sdk/client-redshift-data');

async function execAndWait(client, sqls, workgroupName, database, secretArn) {
  const { Id } = await client.send(
    new BatchExecuteStatementCommand({
      WorkgroupName: workgroupName,
      Database: database,
      SecretArn: secretArn,
      Sqls: sqls,
    }),
  );
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { Status, Error: err } = await client.send(
      new DescribeStatementCommand({ Id }),
    );
    if (Status === 'FINISHED') return;
    if (['FAILED', 'ABORTED'].includes(Status))
      throw new Error('Redshift statement failed: ' + err);
  }
  throw new Error('Redshift statement timed out after 60 s');
}

exports.handler = async (event) => {
  if (event.RequestType === 'Delete') {
    return {
      PhysicalResourceId: event.PhysicalResourceId ?? 'redshift-schema',
    };
  }

  const { workgroupName, database, adminSecretArn, userSecretArn } =
    event.ResourceProperties;

  const sm = new SecretsManagerClient({});
  const { SecretString } = await sm.send(
    new GetSecretValueCommand({ SecretId: userSecretArn }),
  );
  const userPass = JSON.parse(SecretString).password;

  const client = new RedshiftDataClient({});

  await execAndWait(
    client,
    [
      'CREATE SCHEMA IF NOT EXISTS experimentation',
      [
        'CREATE TABLE IF NOT EXISTS experimentation.fact_events (',
        'event_id VARCHAR(36), user_id VARCHAR(255), anonymous_id VARCHAR(255),',
        'timestamp TIMESTAMP, event_type VARCHAR(255), page_path VARCHAR(1024),',
        'session_id VARCHAR(36), device_type VARCHAR(50), properties VARCHAR(MAX)',
        ')',
      ].join(' '),
      [
        'CREATE TABLE IF NOT EXISTS experimentation.fact_orders (',
        'order_id VARCHAR(36), user_id VARCHAR(255), anonymous_id VARCHAR(255),',
        'timestamp TIMESTAMP, amount FLOAT8, currency VARCHAR(3),',
        'device_type VARCHAR(50), coupon_code VARCHAR(100)',
        ')',
      ].join(' '),
    ],
    workgroupName,
    database,
    adminSecretArn,
  );

  try {
    await execAndWait(
      client,
      ["CREATE USER growthbook_user PASSWORD '" + userPass + "'"],
      workgroupName,
      database,
      adminSecretArn,
    );
  } catch {}

  await execAndWait(
    client,
    [
      'GRANT USAGE ON SCHEMA experimentation TO growthbook_user',
      'GRANT SELECT ON ALL TABLES IN SCHEMA experimentation TO growthbook_user',
      'ALTER DEFAULT PRIVILEGES IN SCHEMA experimentation GRANT SELECT ON TABLES TO growthbook_user',
    ],
    workgroupName,
    database,
    adminSecretArn,
  );

  return { PhysicalResourceId: 'redshift-schema' };
};
