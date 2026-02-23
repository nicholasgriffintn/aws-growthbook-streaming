const {
  FirehoseClient,
  PutRecordCommand,
} = require("@aws-sdk/client-firehose");
const { randomUUID } = require("crypto");

const firehose = new FirehoseClient({ region: process.env.AWS_REGION });

const DEVICE_TYPES = ["desktop", "mobile", "tablet"];

function normalise(body) {
  const nowIso = new Date().toISOString();
  const amount = body.amount;

  if (amount === undefined || amount === null) {
    throw new Error("amount is required");
  }

  return {
    order_id: body.orderId ?? body.order_id ?? randomUUID(),
    user_id: body.userId ?? body.user_id ?? null,
    anonymous_id:
      body.anonymousId ?? body.anonymous_id ?? `anon_${randomUUID()}`,
    timestamp: body.timestamp ?? nowIso,
    amount: parseFloat(amount),
    currency: body.currency ?? "USD",
    device_type:
      body.deviceType ??
      body.device_type ??
      DEVICE_TYPES[Math.floor(Math.random() * DEVICE_TYPES.length)],
    coupon_code: body.couponCode ?? body.coupon_code ?? null,
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
