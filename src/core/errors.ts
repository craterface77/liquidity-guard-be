export class ServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function notFound(code: string, message: string): ServiceError {
  return new ServiceError(404, code, message);
}

export function badRequest(
  code: string,
  message: string,
  details?: unknown
): ServiceError {
  return new ServiceError(400, code, message, details);
}

export function conflict(code: string, message: string): ServiceError {
  return new ServiceError(409, code, message);
}
