const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const {
  RedshiftDataClient,
  BatchExecuteStatementCommand,
  DescribeStatementCommand,
} = require("@aws-sdk/client-redshift-data");

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
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { Status, Error: error } = await client.send(
      new DescribeStatementCommand({ Id }),
    );

    if (Status === "FINISHED") {
      return;
    }

    if (["FAILED", "ABORTED"].includes(Status)) {
      throw new Error(`Redshift statement failed: ${error}`);
    }
  }

  throw new Error("Redshift statement timed out after 60 s");
}

function buildSetupStatements() {
  return [
    "CREATE SCHEMA IF NOT EXISTS experimentation",
    [
      "CREATE TABLE IF NOT EXISTS experimentation.fact_events (",
      "event_id VARCHAR(36), user_id VARCHAR(255), anonymous_id VARCHAR(255),",
      "timestamp TIMESTAMP, event_type VARCHAR(255), page_path VARCHAR(1024),",
      "session_id VARCHAR(36), device_type VARCHAR(50), properties VARCHAR(MAX)",
      ")",
    ].join(" "),
    [
      "ALTER TABLE experimentation.fact_events",
      "ADD COLUMN IF NOT EXISTS page_category VARCHAR(255),",
      "ADD COLUMN IF NOT EXISTS country VARCHAR(8),",
      "ADD COLUMN IF NOT EXISTS referrer_domain VARCHAR(255),",
      "ADD COLUMN IF NOT EXISTS logged_in BOOLEAN,",
      "ADD COLUMN IF NOT EXISTS experiment_id VARCHAR(255),",
      "ADD COLUMN IF NOT EXISTS variation_id VARCHAR(255),",
      "ADD COLUMN IF NOT EXISTS feature_key VARCHAR(255),",
      "ADD COLUMN IF NOT EXISTS feature_value VARCHAR(255)",
    ].join(" "),
    [
      "CREATE TABLE IF NOT EXISTS experimentation.fact_orders (",
      "order_id VARCHAR(36), user_id VARCHAR(255), anonymous_id VARCHAR(255),",
      "timestamp TIMESTAMP, amount FLOAT8, currency VARCHAR(3),",
      "device_type VARCHAR(50), coupon_code VARCHAR(100)",
      ")",
    ].join(" "),
    [
      "ALTER TABLE experimentation.fact_orders",
      "ADD COLUMN IF NOT EXISTS session_id VARCHAR(36),",
      "ADD COLUMN IF NOT EXISTS country VARCHAR(8),",
      "ADD COLUMN IF NOT EXISTS referrer_domain VARCHAR(255),",
      "ADD COLUMN IF NOT EXISTS logged_in BOOLEAN,",
      "ADD COLUMN IF NOT EXISTS order_status VARCHAR(30),",
      "ADD COLUMN IF NOT EXISTS properties VARCHAR(MAX)",
    ].join(" "),
    [
      "CREATE OR REPLACE VIEW experimentation.experiment_assignments AS",
      "SELECT",
      "COALESCE(user_id, anonymous_id) AS unit_id,",
      "user_id,",
      "anonymous_id,",
      "session_id,",
      "timestamp,",
      "COALESCE(experiment_id, json_extract_path_text(properties, 'experiment_id'), json_extract_path_text(properties, 'experimentId')) AS experiment_id,",
      "COALESCE(variation_id, json_extract_path_text(properties, 'variation_id'), json_extract_path_text(properties, 'variationId')) AS variation_id,",
      "device_type,",
      "country,",
      "referrer_domain,",
      "logged_in,",
      "page_path,",
      "page_category",
      "FROM experimentation.fact_events",
      "WHERE event_type IN ('experiment_viewed', 'viewed_experiment')",
      "AND COALESCE(user_id, anonymous_id) IS NOT NULL",
      "AND COALESCE(experiment_id, json_extract_path_text(properties, 'experiment_id'), json_extract_path_text(properties, 'experimentId')) IS NOT NULL",
      "AND COALESCE(variation_id, json_extract_path_text(properties, 'variation_id'), json_extract_path_text(properties, 'variationId')) IS NOT NULL",
    ].join(" "),
    [
      "CREATE OR REPLACE VIEW experimentation.viewed_experiment AS",
      "SELECT",
      "user_id,",
      "anonymous_id,",
      "timestamp,",
      "experiment_id,",
      "variation_id",
      "FROM experimentation.experiment_assignments",
    ].join(" "),
    [
      "CREATE OR REPLACE VIEW experimentation.feature_usage AS",
      "SELECT",
      "COALESCE(user_id, anonymous_id) AS unit_id,",
      "user_id,",
      "anonymous_id,",
      "session_id,",
      "timestamp,",
      "COALESCE(feature_key, json_extract_path_text(properties, 'feature_key'), json_extract_path_text(properties, 'featureKey')) AS feature_key,",
      "COALESCE(feature_value, json_extract_path_text(properties, 'feature_value'), json_extract_path_text(properties, 'featureValue'), json_extract_path_text(properties, 'value')) AS feature_value,",
      "device_type,",
      "country,",
      "referrer_domain,",
      "logged_in,",
      "page_path",
      "FROM experimentation.fact_events",
      "WHERE event_type IN ('feature_usage', 'feature_evaluated')",
      "AND COALESCE(user_id, anonymous_id) IS NOT NULL",
      "AND COALESCE(feature_key, json_extract_path_text(properties, 'feature_key'), json_extract_path_text(properties, 'featureKey')) IS NOT NULL",
    ].join(" "),
    [
      "CREATE OR REPLACE VIEW experimentation.session_metrics AS",
      "SELECT",
      "COALESCE(user_id, anonymous_id) AS unit_id,",
      "user_id,",
      "anonymous_id,",
      "session_id,",
      "MIN(timestamp) AS session_start_at,",
      "MAX(timestamp) AS session_end_at,",
      "DATEDIFF(seconds, MIN(timestamp), MAX(timestamp)) AS session_length_seconds,",
      "MAX(device_type) AS device_type,",
      "MAX(country) AS country,",
      "MAX(referrer_domain) AS referrer_domain,",
      "MAX(CASE WHEN logged_in THEN 1 ELSE 0 END) = 1 AS logged_in,",
      "COUNT(*) AS event_count,",
      "SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,",
      "SUM(CASE WHEN event_type = 'add_to_cart' THEN 1 ELSE 0 END) AS add_to_carts,",
      "SUM(CASE WHEN event_type = 'checkout_start' THEN 1 ELSE 0 END) AS checkout_starts,",
      "SUM(CASE WHEN event_type = 'signup' THEN 1 ELSE 0 END) AS signups",
      "FROM experimentation.fact_events",
      "WHERE COALESCE(user_id, anonymous_id) IS NOT NULL",
      "AND session_id IS NOT NULL",
      "GROUP BY 1, 2, 3, 4",
    ].join(" "),
    [
      "CREATE OR REPLACE VIEW experimentation.checkout_funnel AS",
      "SELECT",
      "sm.unit_id,",
      "sm.user_id,",
      "sm.anonymous_id,",
      "sm.session_id,",
      "sm.session_start_at,",
      "sm.session_end_at,",
      "sm.device_type,",
      "sm.country,",
      "sm.referrer_domain,",
      "sm.logged_in,",
      "sm.page_views,",
      "sm.add_to_carts,",
      "sm.checkout_starts,",
      "COUNT(DISTINCT o.order_id) AS order_count,",
      "COALESCE(SUM(o.amount), 0) AS revenue,",
      "MAX(CASE WHEN o.order_id IS NOT NULL THEN 1 ELSE 0 END) = 1 AS converted",
      "FROM experimentation.session_metrics sm",
      "LEFT JOIN experimentation.fact_orders o",
      "ON sm.session_id = o.session_id",
      "GROUP BY",
      "sm.unit_id, sm.user_id, sm.anonymous_id, sm.session_id,",
      "sm.session_start_at, sm.session_end_at, sm.device_type, sm.country,",
      "sm.referrer_domain, sm.logged_in, sm.page_views, sm.add_to_carts, sm.checkout_starts",
    ].join(" "),
    [
      "CREATE OR REPLACE VIEW experimentation.user_day_metrics AS",
      "WITH activity AS (",
      "SELECT",
      "COALESCE(user_id, anonymous_id) AS unit_id,",
      "user_id,",
      "anonymous_id,",
      "CAST(timestamp AS DATE) AS activity_date,",
      "session_id,",
      "device_type,",
      "country,",
      "referrer_domain,",
      "logged_in,",
      "CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END AS page_views,",
      "CASE WHEN event_type = 'add_to_cart' THEN 1 ELSE 0 END AS add_to_carts,",
      "CASE WHEN event_type = 'checkout_start' THEN 1 ELSE 0 END AS checkout_starts,",
      "CASE WHEN event_type = 'signup' THEN 1 ELSE 0 END AS signups,",
      "0 AS order_count,",
      "0::FLOAT8 AS revenue",
      "FROM experimentation.fact_events",
      "UNION ALL",
      "SELECT",
      "COALESCE(user_id, anonymous_id) AS unit_id,",
      "user_id,",
      "anonymous_id,",
      "CAST(timestamp AS DATE) AS activity_date,",
      "session_id,",
      "device_type,",
      "country,",
      "referrer_domain,",
      "logged_in,",
      "0 AS page_views,",
      "0 AS add_to_carts,",
      "0 AS checkout_starts,",
      "0 AS signups,",
      "1 AS order_count,",
      "amount AS revenue",
      "FROM experimentation.fact_orders",
      ")",
      "SELECT",
      "unit_id,",
      "user_id,",
      "anonymous_id,",
      "activity_date,",
      "COUNT(DISTINCT session_id) AS sessions,",
      "MAX(device_type) AS device_type,",
      "MAX(country) AS country,",
      "MAX(referrer_domain) AS referrer_domain,",
      "MAX(CASE WHEN logged_in THEN 1 ELSE 0 END) = 1 AS logged_in,",
      "SUM(page_views) AS page_views,",
      "SUM(add_to_carts) AS add_to_carts,",
      "SUM(checkout_starts) AS checkout_starts,",
      "SUM(signups) AS signups,",
      "SUM(order_count) AS orders,",
      "SUM(revenue) AS revenue",
      "FROM activity",
      "WHERE unit_id IS NOT NULL",
      "GROUP BY 1, 2, 3, 4",
    ].join(" "),
  ];
}

exports.handler = async (event) => {
  if (event.RequestType === "Delete") {
    return {
      PhysicalResourceId: event.PhysicalResourceId ?? "redshift-schema",
    };
  }

  const { workgroupName, database, adminSecretArn, userSecretArn } =
    event.ResourceProperties;

  const secretsManager = new SecretsManagerClient({});
  const { SecretString } = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: userSecretArn }),
  );
  const userPass = JSON.parse(SecretString).password;

  const client = new RedshiftDataClient({});

  await execAndWait(
    client,
    buildSetupStatements(),
    workgroupName,
    database,
    adminSecretArn,
  );

  try {
    await execAndWait(
      client,
      [`CREATE USER growthbook_user PASSWORD '${userPass}'`],
      workgroupName,
      database,
      adminSecretArn,
    );
  } catch {}

  await execAndWait(
    client,
    [
      "GRANT USAGE ON SCHEMA experimentation TO growthbook_user",
      "GRANT SELECT ON ALL TABLES IN SCHEMA experimentation TO growthbook_user",
      "ALTER DEFAULT PRIVILEGES IN SCHEMA experimentation GRANT SELECT ON TABLES TO growthbook_user",
      "GRANT SELECT ON experimentation.experiment_assignments TO growthbook_user",
      "GRANT SELECT ON experimentation.viewed_experiment TO growthbook_user",
      "GRANT SELECT ON experimentation.feature_usage TO growthbook_user",
      "GRANT SELECT ON experimentation.session_metrics TO growthbook_user",
      "GRANT SELECT ON experimentation.checkout_funnel TO growthbook_user",
      "GRANT SELECT ON experimentation.user_day_metrics TO growthbook_user",
    ],
    workgroupName,
    database,
    adminSecretArn,
  );

  return { PhysicalResourceId: "redshift-schema" };
};
