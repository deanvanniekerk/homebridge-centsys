export type ErrorCode =
  | "configuration"
  | "authentication"
  | "otp-rejected"
  | "otp-not-sent"
  | "rate-limited"
  | "http"
  | "transport"
  | "timeout"
  | "cancelled"
  | "protocol"
  | "local-storage"
  | "control-disabled"
  | "state-unavailable"
  | "busy"
  | "command-uncertain"
  | "command-rejected"
  | "gate-authentication";

const messages: Record<ErrorCode, string> = {
  "gate-authentication":
    "The controller rejected the remote identity. Check the protocol address and Remote user registration.",
  "control-disabled": "Gate control is not enabled for this configuration.",
  "state-unavailable":
    "A usable gate state is unavailable. The command was not sent.",
  busy: "A gate operation is already in progress.",
  "command-uncertain":
    "The activation outcome is unknown. Check the gate before retrying.",
  "command-rejected":
    "The gate rejected the activation. No further command was sent.",
  configuration: "Invalid configuration or input.",
  authentication: "Authentication was rejected. Sign in again.",
  "otp-rejected": "The one-time code was rejected.",
  "otp-not-sent": "The service did not confirm sending a one-time code.",
  "rate-limited":
    "The service rate-limited this request. Wait before trying again.",
  http: "The service returned an unsuccessful HTTP response.",
  transport: "Could not reach the service securely.",
  timeout: "The request exceeded its deadline.",
  cancelled: "The operation was cancelled.",
  protocol: "The service response did not match the expected protocol.",
  "local-storage": "Could not read or write a private local credential file.",
};

const diagnosticLabels = {
  operation: [
    "SendOtp",
    "ValidateOtp",
    "GetDevicesByRemoteUserNumber",
    "GetOperatorOverview",
    "GetCertificate",
    "mqtt",
  ],
  stage: [
    "connect",
    "subscribe",
    "identity",
    "telemetry",
    "time",
    "activating",
    "ack",
  ],
  reason: [
    "missing-body",
    "body-too-large",
    "invalid-json",
    "expected-record",
    "expected-list",
    "too-many-rows",
    "invalid-serial",
    "expected-integer",
    "expected-boolean",
    "duplicate-identity",
    "unexpected-identity",
    "invalid-certificate",
    "subscription-rejected",
    "packet-length",
    "response-envelope",
    "telemetry-padding",
    "missing-telemetry",
  ],
  field: [
    "serialNumber",
    "operatorSerialNumber",
    "productCode",
    "productType",
    "isWifiDevice",
    "isOnline",
    "operatorStatus",
    "powerSupplyStatus",
    "closingBeamStatus",
    "openingBeamStatus",
    "theftAlarmState",
  ],
} as const;

export type ErrorDiagnostic = {
  [K in keyof typeof diagnosticLabels]?: (typeof diagnosticLabels)[K][number];
} & { bytes?: number; status?: number };

/** Runtime allowlist: even JavaScript callers cannot inject server text into logs. */
function safeDiagnostic(input: ErrorDiagnostic): Readonly<ErrorDiagnostic> {
  const result: Record<string, string | number> = {};
  for (const key of Object.keys(
    diagnosticLabels,
  ) as (keyof typeof diagnosticLabels)[]) {
    const value = input[key];
    if (
      typeof value === "string" &&
      (diagnosticLabels[key] as readonly string[]).includes(value)
    )
      result[key] = value;
  }
  for (const key of ["bytes", "status"] as const) {
    const value = input[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= (key === "status" ? 599 : 268435455)
    )
      result[key] = value;
  }
  return Object.freeze(result);
}

/** Public messages stay fixed; opt-in diagnostic formatting adds only allowlisted metadata. */
export class CentsysError extends Error {
  readonly diagnostic: Readonly<ErrorDiagnostic>;
  constructor(
    readonly code: ErrorCode,
    diagnostic: ErrorDiagnostic = {},
  ) {
    super(messages[code]);
    this.name = "CentsysError";
    this.diagnostic = safeDiagnostic(diagnostic);
  }
  withContext(context: ErrorDiagnostic): CentsysError {
    return new CentsysError(this.code, { ...context, ...this.diagnostic });
  }
}

export function formatError(error: CentsysError): string {
  const details = Object.entries(safeDiagnostic(error.diagnostic))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return `${messages[error.code]}${details ? ` [${details}]` : ""}`;
}
