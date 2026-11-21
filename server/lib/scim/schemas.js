import { USER_SCHEMA, ENTERPRISE_SCHEMA, GROUP_SCHEMA } from './resources.js';

function attr(name, { type = 'string', multiValued = false, required = false, caseExact = false, mutability = 'readWrite', returned = 'default', uniqueness = 'none', subAttributes, canonicalValues, referenceTypes, description } = {}) {
  return {
    name, type, multiValued, description: description || name, required, caseExact, mutability, returned, uniqueness,
    ...(subAttributes ? { subAttributes } : {}), ...(canonicalValues ? { canonicalValues } : {}), ...(referenceTypes ? { referenceTypes } : {})
  };
}

const typed = (types) => [attr('value'), attr('display'), attr('type', { canonicalValues: types }), attr('primary', { type: 'boolean' })];

const USER = {
  id: USER_SCHEMA, name: 'User', description: 'User Account',
  attributes: [
    attr('userName', { required: true, uniqueness: 'server', description: 'Unique identifier for the user, usually the work email address.' }),
    attr('name', { type: 'complex', subAttributes: ['formatted', 'familyName', 'givenName', 'middleName', 'honorificPrefix', 'honorificSuffix'].map(n => attr(n)) }),
    attr('displayName'),
    attr('nickName'),
    attr('title'),
    attr('userType'),
    attr('preferredLanguage'),
    attr('locale'),
    attr('timezone'),
    attr('active', { type: 'boolean', description: 'False disables the account, ends its sessions and stops its running replies.' }),
    attr('emails', { type: 'complex', multiValued: true, subAttributes: typed(['work', 'home', 'other']), description: 'The primary or work address becomes the sign-in email.' }),
    attr('phoneNumbers', { type: 'complex', multiValued: true, subAttributes: typed(['work', 'home', 'mobile', 'other']) }),
    attr('groups', {
      type: 'complex', multiValued: true, mutability: 'readOnly',
      subAttributes: [attr('value', { mutability: 'readOnly' }), attr('$ref', { type: 'reference', referenceTypes: ['Group'], mutability: 'readOnly' }), attr('display', { mutability: 'readOnly' }), attr('type', { mutability: 'readOnly', canonicalValues: ['direct'] })]
    })
  ]
};

const ENTERPRISE = {
  id: ENTERPRISE_SCHEMA, name: 'EnterpriseUser', description: 'Enterprise User',
  attributes: [
    ...['employeeNumber', 'costCenter', 'organization', 'division', 'department'].map(n => attr(n)),
    attr('manager', { type: 'complex', subAttributes: [attr('value')] })
  ]
};

const GROUP = {
  id: GROUP_SCHEMA, name: 'Group', description: 'Group',
  attributes: [
    attr('displayName', { required: true, uniqueness: 'server' }),
    attr('members', {
      type: 'complex', multiValued: true, description: 'People in the group. Groups inside groups are not supported.',
      subAttributes: [attr('value', { mutability: 'immutable' }), attr('$ref', { type: 'reference', referenceTypes: ['User'], mutability: 'immutable' }), attr('display', { mutability: 'readOnly' }), attr('type', { mutability: 'immutable', canonicalValues: ['User'] })]
    })
  ]
};

export const SCHEMA_LIST = [USER, ENTERPRISE, GROUP].map(s => ({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'], ...s }));

export const RESOURCE_TYPES = [
  { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', description: 'User Account', schema: USER_SCHEMA, schemaExtensions: [{ schema: ENTERPRISE_SCHEMA, required: false }] },
  { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group', schema: GROUP_SCHEMA }
];

export function serviceProviderConfig(base) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'OAuth Bearer Token', description: 'A provisioning token created by an owner under Admin, Provisioning.', primary: true }],
    meta: { resourceType: 'ServiceProviderConfig', location: `${base}/ServiceProviderConfig` }
  };
}