import { PrivyClient } from '@privy-io/node';

export interface VerifiedToken {
  did: string;
}

export interface AuthVerifier {
  /** Throws when the token is invalid, expired or issued for another app. */
  verify(token: string): Promise<VerifiedToken>;
  /** The user's first linked wallet, read server-side. */
  getWallet(did: string): Promise<string | null>;
}

interface PrivyOptions {
  appId: string;
  appSecret: string;
  verificationKey: string | undefined;
}

export function createPrivyVerifier(options: PrivyOptions): AuthVerifier {
  const client = new PrivyClient({
    appId: options.appId,
    appSecret: options.appSecret,
    ...(options.verificationKey === undefined
      ? {}
      : { jwtVerificationKey: options.verificationKey }),
  });

  return {
    async verify(token) {
      const claims = await client.utils().auth().verifyAccessToken(token);
      return { did: claims.user_id };
    },

    async getWallet(did) {
      const user = await client.users()._get(did);
      for (const account of user.linked_accounts) {
        if (account.type === 'wallet' && 'address' in account && account.chain_type === 'ethereum') {
          return account.address;
        }
      }
      return null;
    },
  };
}
