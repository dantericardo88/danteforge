import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

export interface EncryptionOptions {
  algorithm?: string;
  keyLength?: number;
  enableAtRest?: boolean;
  enableInTransit?: boolean;
}

export class EncryptionManager {
  private options: EncryptionOptions;
  private keyStore: Map<string, Buffer> = new Map();

  constructor(options: EncryptionOptions = {}) {
    this.options = {
      algorithm: 'aes-256-gcm',
      keyLength: 32,
      enableAtRest: true,
      enableInTransit: false,
      ...options
    };
  }

  async generateKey(keyId: string): Promise<void> {
    const key = crypto.randomBytes(this.options.keyLength!);
    this.keyStore.set(keyId, key);
    logger.info(`Encryption key generated: ${keyId}`);
  }

  async encryptData(data: string, keyId: string): Promise<string> {
    const key = this.keyStore.get(keyId);
    if (!key) {
      throw new Error(`Encryption key not found: ${keyId}`);
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.options.algorithm!, key);

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Store IV and auth tag with encrypted data
    const result = JSON.stringify({
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      algorithm: this.options.algorithm
    });

    logger.info(`Data encrypted with key: ${keyId}`);
    return result;
  }

  async decryptData(encryptedData: string, keyId: string): Promise<string> {
    const key = this.keyStore.get(keyId);
    if (!key) {
      throw new Error(`Encryption key not found: ${keyId}`);
    }

    const { encrypted, iv, authTag, algorithm } = JSON.parse(encryptedData);

    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    logger.info(`Data decrypted with key: ${keyId}`);
    return decrypted;
  }

  async encryptFile(filePath: string, keyId: string): Promise<void> {
    if (!this.options.enableAtRest) {
      return; // Skip encryption if disabled
    }

    const content = await fs.readFile(filePath, 'utf8');
    const encrypted = await this.encryptData(content, keyId);

    // Create encrypted file with .enc extension
    const encryptedPath = `${filePath}.enc`;
    await fs.writeFile(encryptedPath, encrypted, 'utf8');

    // Optionally remove original file
    await fs.unlink(filePath);

    logger.info(`File encrypted: ${filePath} -> ${encryptedPath}`);
  }

  async decryptFile(encryptedPath: string, keyId: string, outputPath?: string): Promise<void> {
    const encryptedContent = await fs.readFile(encryptedPath, 'utf8');
    const decrypted = await this.decryptData(encryptedContent, keyId);

    const finalPath = outputPath || encryptedPath.replace('.enc', '');
    await fs.writeFile(finalPath, decrypted, 'utf8');

    logger.info(`File decrypted: ${encryptedPath} -> ${finalPath}`);
  }

  getEncryptionStatus(): {
    keysGenerated: number;
    atRestEnabled: boolean;
    inTransitEnabled: boolean;
    algorithm: string;
  } {
    return {
      keysGenerated: this.keyStore.size,
      atRestEnabled: this.options.enableAtRest!,
      inTransitEnabled: this.options.enableInTransit!,
      algorithm: this.options.algorithm!
    };
  }
}