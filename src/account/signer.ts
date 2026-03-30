import { privateKeyToAccount } from "viem/accounts";

export type SignedPayment = {
  signature: `0x${string}`;
  accountAddress: `0x${string}`;
  signedAt: string;
};

export async function signPaymentBlob({
  privateKey,
  payload,
}: {
  privateKey: `0x${string}`;
  payload: string;
}): Promise<SignedPayment> {
  const account = privateKeyToAccount(privateKey);
  const signature = await account.signMessage({ message: payload });
  return {
    signature,
    accountAddress: account.address,
    signedAt: new Date().toISOString(),
  };
}
