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

/** Never includes request URLs, account identifiers, response bodies or nested causes. */
export class CentsysError extends Error {
  constructor(readonly code: ErrorCode) {
    super(messages[code]);
    this.name = "CentsysError";
  }
}
