const {
  FirehoseClient,
  PutRecordCommand,
} = require("@aws-sdk/client-firehose");
const { randomUUID } = require("crypto");

const firehose = new FirehoseClient({ region: process.env.AWS_REGION });

const DEVICE_TYPES = ["desktop", "mobile", "tablet"];

function normalise(body) {
  const nowIso = new Date().toISOString();
  const eventType = body.eventType ?? body.event_type;

  if (!eventType) {
    throw new Error("eventType is required");
  }

  return {
    event_id: body.eventId ?? body.event_id ?? randomUUID(),
    user_id: body.userId ?? body.user_id ?? null,
    anonymous_id:
      body.anonymousId ?? body.anonymous_id ?? `anon_${randomUUID()}`,
    timestamp: body.timestamp ?? nowIso,
    event_type: eventType,
    page_path: body.pagePath ?? body.page_path ?? null,
    session_id: body.sessionId ?? body.session_id ?? null,
    device_type:
      body.deviceType ??
      body.device_type ??
      DEVICE_TYPES[Math.floor(Math.random() * DEVICE_TYPES.length)],
    properties: JSON.stringify(body.properties ?? {}),
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
