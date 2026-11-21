export const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

export class ScimError extends Error {
  constructor(status, scimType, detail) {
    super(detail);
    this.status = status;
    this.scimType = scimType;
  }
}

export function errorBody(status, scimType, detail) {
  return { schemas: [ERROR_SCHEMA], status: String(status), ...(scimType ? { scimType } : {}), detail };
}