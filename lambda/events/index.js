const {
  FirehoseClient,
  PutRecordCommand,
} = require("@aws-sdk/client-firehose");
const { randomUUID } = require("crypto");

const firehose = new FirehoseClient({ region: process.env.AWS_REGION });

const DEVICE_TYPES = ["desktop", "mobile", "tablet"];
const COUNTRIES = ["GB", "US", "DE", "FR"];

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function asNullableString(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value);
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalised = String(value).trim().toLowerCase();
  return ["true", "1", "yes", "logged_in"].includes(normalised);
}

function derivePageCategory(path) {
  if (!path) {
    return null;
  }

  if (path === "/") {
    return "home";
  }

  const [segment] = path.split("/").filter(Boolean);
  return segment ?? null;
}

function extractReferrerDomain(value) {
  const referrer = asNullableString(value);
  if (!referrer) {
    return null;
  }

  try {
    return new URL(referrer).hostname;
  } catch {
    return referrer
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .trim()
      .toLowerCase();
  }
}

function normalise(body) {
  const nowIso = new Date().toISOString();
  const eventType = body.eventType ?? body.event_type;
  const pagePath = asNullableString(body.pagePath ?? body.page_path);
  const referrerDomain = extractReferrerDomain(
    firstDefined(body.referrerDomain, body.referrer_domain, body.referrer),
  );
  const country = asNullableString(body.country) ??
    COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
  const loggedIn = asBoolean(
    firstDefined(body.loggedIn, body.logged_in, body.userLoggedIn),
    false,
  );
  const experimentId = asNullableString(
    firstDefined(
      body.experimentId,
      body.experiment_id,
      body.properties?.experimentId,
      body.properties?.experiment_id,
    ),
  );
  const variationId = asNullableString(
    firstDefined(
      body.variationId,
      body.variation_id,
      body.properties?.variationId,
      body.properties?.variation_id,
    ),
  );
  const featureKey = asNullableString(
    firstDefined(
      body.featureKey,
      body.feature_key,
      body.properties?.featureKey,
      body.properties?.feature_key,
    ),
  );
  const featureValue = asNullableString(
    firstDefined(
      body.featureValue,
      body.feature_value,
      body.properties?.featureValue,
      body.properties?.feature_value,
      body.properties?.value,
    ),
  );

  if (!eventType) {
    throw new Error("eventType is required");
  }

  const properties = {
    ...(body.properties ?? {}),
    country,
    logged_in: loggedIn,
    referrer_domain: referrerDomain,
    page_category: derivePageCategory(pagePath),
    ...(experimentId ? { experiment_id: experimentId } : {}),
    ...(variationId ? { variation_id: variationId } : {}),
    ...(featureKey ? { feature_key: featureKey } : {}),
    ...(featureValue ? { feature_value: featureValue } : {}),
  };

  return {
    event_id: body.eventId ?? body.event_id ?? randomUUID(),
    user_id: body.userId ?? body.user_id ?? null,
    anonymous_id:
      body.anonymousId ?? body.anonymous_id ?? `anon_${randomUUID()}`,
    timestamp: body.timestamp ?? nowIso,
    event_type: eventType,
    page_path: pagePath,
    page_category: derivePageCategory(pagePath),
    session_id: body.sessionId ?? body.session_id ?? null,
    device_type:
      body.deviceType ??
      body.device_type ??
      DEVICE_TYPES[Math.floor(Math.random() * DEVICE_TYPES.length)],
    country,
    referrer_domain: referrerDomain,
    logged_in: loggedIn,
    experiment_id: experimentId,
    variation_id: variationId,
    feature_key: featureKey,
    feature_value: featureValue,
    properties: JSON.stringify(properties),
  };
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const record = normalise(body);

    await firehose.send(
      new PutRecordCommand({
        DeliveryStreamName: process.env.FIREHOSE_STREAM_NAME,
        Record: { Data: Buffer.from(JSON.stringify(record) + "\n") },
      }),
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: JSON.stringify({ success: true, message: "Event queued" }),
    };
  } catch (error) {
    console.error("Events error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
