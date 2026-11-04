// Tests de tipos de SabreConfig + buildCredentials (#148). Los corre `npm run typecheck`; en
// vitest solo se ejecutan los `expectTypeOf`, nunca los constructores de las funciones `_`.
import { describe, expectTypeOf, it } from 'vitest';
import { Sabre, SabreLegacy, buildCredentials } from '../src/index.js';
import type { BuiltCredentialsV2, BuiltCredentialsV3, SabreConfig, SabreCredentialsV2 } from '../src/index.js';

const parts = { user: '7971', pcc: 'H8GI', password: 'epr-pass' };
const app = { clientId: 'app-client-id', clientSecret: 'app-client-secret' };

describe('tipos de SabreConfig con buildCredentials', () => {
  it('v2: la config no necesita repetir authVersion', () => {
    const credentials = buildCredentials({ ...parts, authVersion: 'v2' });
    expectTypeOf(credentials).toEqualTypeOf<BuiltCredentialsV2>();
    expectTypeOf(credentials.authVersion).toEqualTypeOf<'v2'>();
    expectTypeOf({ environment: 'sandbox' as const, credentials }).toMatchTypeOf<SabreConfig>();

    const _ = () => {
      new Sabre({ environment: 'sandbox', credentials });
      new SabreLegacy({ environment: 'sandbox', credentials });
      new Sabre({ environment: 'sandbox', authVersion: 'v2', credentials });
      new Sabre({ environment: 'sandbox', credentials: buildCredentials({ ...parts, ...app, authVersion: 'v2' }) });
      // @ts-expect-error credenciales v2 con una config v3
      new Sabre({ environment: 'sandbox', authVersion: 'v3', credentials });
    };
  });

  it('v3: compila con y sin authVersion', () => {
    const credentials = buildCredentials({ ...parts, ...app });
    expectTypeOf(credentials).toEqualTypeOf<BuiltCredentialsV3>();
    expectTypeOf(buildCredentials({ ...parts, ...app, authVersion: 'v3' })).toEqualTypeOf<BuiltCredentialsV3>();

    const _ = () => {
      new Sabre({ environment: 'sandbox', credentials });
      new Sabre({ environment: 'sandbox', authVersion: 'v3', credentials });
      new SabreLegacy({ environment: 'production', credentials });
      // @ts-expect-error credenciales v3 con una config v2
      new Sabre({ environment: 'sandbox', authVersion: 'v2', credentials });
    };
  });

  it('credenciales a mano: sin marca, v2 sigue pidiendo authVersion en la config', () => {
    const v2: SabreCredentialsV2 = { username: 'V1:7971:H8GI:AA', password: 'epr-pass' };

    const _ = () => {
      new Sabre({ environment: 'sandbox', authVersion: 'v2', credentials: v2 });
      // @ts-expect-error sin marca ni authVersion, la config es v3 y pide clientId/clientSecret
      new Sabre({ environment: 'sandbox', credentials: v2 });
      new Sabre({ environment: 'sandbox', credentials: { ...app, username: '7971-H8GI-AA', password: 'epr-pass' } });
    };
  });
});
