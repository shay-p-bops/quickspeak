export const LLM_API_KEY_STORAGE_KEY = "quickspeak.llm.apiKey.v1";

const DATABASE_NAME = "quickspeak-secrets";
const DATABASE_VERSION = 1;
const KEY_STORE_NAME = "crypto-keys";
const API_KEY_ENCRYPTION_KEY_ID = "llm-api-key-encryption";
const PAYLOAD_VERSION = 1;

function assertCrypto(cryptoApi) {
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Web Crypto is not available.");
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function generateEncryptionKey(cryptoApi = globalThis.crypto) {
  assertCrypto(cryptoApi);
  return cryptoApi.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSecret(secret, key, cryptoApi = globalThis.crypto) {
  assertCrypto(cryptoApi);
  const value = String(secret ?? "");
  if (!value) {
    throw new Error("The secret cannot be empty.");
  }

  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  return {
    version: PAYLOAD_VERSION,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted))
  };
}

export async function decryptSecret(payload, key, cryptoApi = globalThis.crypto) {
  assertCrypto(cryptoApi);
  if (
    payload?.version !== PAYLOAD_VERSION ||
    payload?.algorithm !== "AES-GCM" ||
    typeof payload?.iv !== "string" ||
    typeof payload?.ciphertext !== "string"
  ) {
    throw new Error("The encrypted API key payload is invalid.");
  }

  const decrypted = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

function openKeyDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb?.open) {
    return Promise.reject(new Error("IndexedDB is not available."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE_NAME)) {
        database.createObjectStore(KEY_STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Could not open the secret database.")));
  });
}

function readDatabaseValue(database, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, "readonly");
    const request = transaction.objectStore(KEY_STORE_NAME).get(key);
    request.addEventListener("success", () => resolve(request.result ?? null));
    request.addEventListener("error", () => reject(request.error ?? new Error("Could not read the encryption key.")));
  });
}

function writeDatabaseValue(database, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE_NAME, "readwrite");
    transaction.objectStore(KEY_STORE_NAME).put(value, key);
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Could not save the encryption key.")));
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Saving the encryption key was aborted.")));
  });
}

async function getOrCreateEncryptionKey({ indexedDb, cryptoApi }) {
  const database = await openKeyDatabase(indexedDb);
  try {
    const storedKey = await readDatabaseValue(database, API_KEY_ENCRYPTION_KEY_ID);
    if (storedKey) {
      return storedKey;
    }

    const key = await generateEncryptionKey(cryptoApi);
    await writeDatabaseValue(database, API_KEY_ENCRYPTION_KEY_ID, key);
    return key;
  } finally {
    database.close();
  }
}

function storageCall(chromeApi, method, ...args) {
  return new Promise((resolve, reject) => {
    chromeApi.storage.local[method](...args, (result) => {
      const error = chromeApi.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(result);
      }
    });
  });
}

export class EncryptedSecretStore {
  constructor({
    chromeApi = globalThis.chrome,
    cryptoApi = globalThis.crypto,
    indexedDb = globalThis.indexedDB
  } = {}) {
    if (!chromeApi?.storage?.local) {
      throw new Error("Chrome extension storage is not available.");
    }
    this.chromeApi = chromeApi;
    this.cryptoApi = cryptoApi;
    this.indexedDb = indexedDb;
  }

  async save(secret) {
    const value = String(secret ?? "").trim();
    if (!value) {
      throw new Error("The API key cannot be empty.");
    }
    const key = await getOrCreateEncryptionKey(this);
    const payload = await encryptSecret(value, key, this.cryptoApi);
    await storageCall(
      this.chromeApi,
      "set",
      { [LLM_API_KEY_STORAGE_KEY]: payload }
    );
  }

  async has() {
    const result = await storageCall(
      this.chromeApi,
      "get",
      LLM_API_KEY_STORAGE_KEY
    );
    return Boolean(result?.[LLM_API_KEY_STORAGE_KEY]);
  }

  async clear() {
    await storageCall(this.chromeApi, "remove", LLM_API_KEY_STORAGE_KEY);
  }

  async use(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("callback must be a function.");
    }

    const result = await storageCall(
      this.chromeApi,
      "get",
      LLM_API_KEY_STORAGE_KEY
    );
    const payload = result?.[LLM_API_KEY_STORAGE_KEY];
    if (!payload) {
      throw new Error("No API key has been saved.");
    }

    const key = await getOrCreateEncryptionKey(this);
    let secret = await decryptSecret(payload, key, this.cryptoApi);
    try {
      return await callback(secret);
    } finally {
      secret = "";
    }
  }
}
