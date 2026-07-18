import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const keyFromSecret = (secret = "") => createHash("sha256").update(String(secret)).digest();

export const encryptConfiguration = (configuration = {}, secret = "", keyVersion = "v1") => {
  if (!secret) throw Object.assign(new Error("CHANNEL_GATEWAY_CONFIG_SECRET is required"), { code: "CONFIG_SECRET_REQUIRED" });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(configuration), "utf8"), cipher.final()]);
  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
    keyVersion,
  };
};

export const decryptConfiguration = ({ ciphertext, iv, authTag } = {}, secret = "") => {
  if (!secret) throw Object.assign(new Error("CHANNEL_GATEWAY_CONFIG_SECRET is required"), { code: "CONFIG_SECRET_REQUIRED" });
  const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(iv));
  decipher.setAuthTag(Buffer.from(authTag));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext);
};
