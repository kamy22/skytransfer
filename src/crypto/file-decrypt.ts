import { SkynetClient } from 'skynet-js';
import CryptoJS from 'crypto-js';
import { EncryptedFileReference } from '../models/encryption';
import { FileDecrypt } from './crypto';
import { getEndpoint } from '../portals';
import { MAX_AXIOS_RETRIES } from '../config';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { ChunkResolver } from './chunk-resolver';

export default class AESFileDecrypt implements FileDecrypt {
  private encryptedFile: EncryptedFileReference;
  private encryptionKey: string;
  private chunkResolver: ChunkResolver;

  skynetClient = new SkynetClient(getEndpoint());

  parts: BlobPart[] = [];

  constructor(encryptedFile: EncryptedFileReference, encryptionKey: string) {
    this.encryptedFile = encryptedFile;
    this.encryptionKey = encryptionKey;
    this.chunkResolver = new ChunkResolver(encryptedFile.encryptionType);
  }

  get decryptChunkSize(): number {
    return this.chunkResolver.decryptChunkSize;
  }

  async decrypt(
    onDecryptProgress: (
      completed: boolean,
      percentage: number
    ) => void = () => {},
    onFileDownloadProgress: (
      completed: boolean,
      percentage: number
    ) => void = () => {}
  ): Promise<File> {
    const url = await this.skynetClient.getSkylinkUrl(
      this.encryptedFile.skylink
    );

    axiosRetry(axios, {
      retries: MAX_AXIOS_RETRIES,
      retryCondition: (_e) => true, // retry no matter what
    });

    const totalChunks = Math.ceil(
      this.encryptedFile.encryptedSize / this.decryptChunkSize
    );

    let rangeStart,
      rangeEnd = 0;

    for (let i = 0; i < totalChunks; i++) {
      rangeStart = i * this.decryptChunkSize;

      if (i === totalChunks - 1) {
        rangeEnd = this.encryptedFile.encryptedSize;
      } else {
        rangeEnd = (i + 1) * this.decryptChunkSize;
      }

      const bytesRange = `bytes=${rangeStart}-${rangeEnd}`;

      try {
        const response = await axios({
          method: 'get',
          url: url,
          headers: {
            Range: bytesRange,
          },
          responseType: 'text',
          onDownloadProgress: (progressEvent) => {
            const progress = Math.round(
              (progressEvent.loaded / progressEvent.total) * 100
            );
            onFileDownloadProgress(false, progress);
          },
        });

        const progress = Math.floor(((i + 1) / totalChunks) * 100);
        onDecryptProgress(false, progress);

        const data: Blob = response.data;
        const chunkPart = await this.decryptBlob(data);
        this.parts.push(chunkPart);
      } catch (error) {
        console.error(error);
        onFileDownloadProgress(true, 0);
      }
    }

    onDecryptProgress(true, 100);

    return new File(this.parts, this.encryptedFile.fileName, {
      type: this.encryptedFile.mimeType,
    });
  }

  private async decryptBlob(encryptedData: Blob): Promise<BlobPart> {
    return new Promise((resolve) => {
      // To give some CPU time in order to refresh the UI.
      setTimeout(() => {
        var decrypted = CryptoJS.AES.decrypt(encryptedData, this.encryptionKey);
        var typedArray = this.convertWordArrayToUint8Array(decrypted);
        resolve(typedArray);
      }, 200);
    });
  }

  private convertWordArrayToUint8Array(wordArray) {
    const arrayOfWords = wordArray.hasOwnProperty('words')
      ? wordArray.words
      : [];
    const length = wordArray.hasOwnProperty('sigBytes')
      ? wordArray.sigBytes
      : arrayOfWords.length * 4;
    let uInt8Array = new Uint8Array(length),
      index = 0,
      word,
      i;
    for (i = 0; i < length; i++) {
      word = arrayOfWords[i];
      uInt8Array[index++] = word >> 24;
      uInt8Array[index++] = (word >> 16) & 0xff;
      uInt8Array[index++] = (word >> 8) & 0xff;
      uInt8Array[index++] = word & 0xff;
    }
    return uInt8Array;
  }
}
