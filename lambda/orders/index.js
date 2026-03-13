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
  const amount = body.amount;
  const country = asNullableString(body.country) ??
    COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
  const referrerDomain = extractReferrerDomain(
    firstDefined(body.referrerDomain, body.referrer_domain, body.referrer),
  );
  const loggedIn = asBoolean(
    firstDefined(body.loggedIn, body.logged_in, body.userLoggedIn),
    false,
  );
  const orderStatus = asNullableString(
    firstDefined(body.orderStatus, body.order_status),
  ) ?? "completed";

  if (amount === undefined || amount === null) {
    throw new Error("amount is required");
  }

  const properties = {
    ...(body.properties ?? {}),
    country,
    logged_in: loggedIn,
    referrer_domain: referrerDomain,
    order_status: orderStatus,
  };

  return {
    order_id: body.orderId ?? body.order_id ?? randomUUID(),
    user_id: body.userId ?? body.user_id ?? null,
    anonymous_id:
      body.anonymousId ?? body.anonymous_id ?? `anon_${randomUUID()}`,
    session_id: body.sessionId ?? body.session_id ?? null,
    timestamp: body.timestamp ?? nowIso,
    amount: parseFloat(amount),
    currency: body.currency ?? "USD",
    device_type:
      body.deviceType ??
      body.device_type ??
      DEVICE_TYPES[Math.floor(Math.random() * DEVICE_TYPES.length)],
    country,
    referrer_domain: referrerDomain,
    logged_in: loggedIn,
    coupon_code: body.couponCode ?? body.coupon_code ?? null,
    order_status: orderStatus,
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
      body: JSON.stringify({ success: true, message: "Order queued" }),
    };
  } catch (error) {
    console.error("Orders error:", error);
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
