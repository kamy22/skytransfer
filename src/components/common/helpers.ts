import { IEncryptedFile } from '../../models/files/encrypted-file';
import { TUS_CHUNK_SIZE, WEB_WORKER_URL } from '../../config';
import { proxy, wrap } from 'comlink';
import { WorkerApi } from '../../workers/worker';
import { message } from 'antd';
import Xchacha20poly1305Decrypt from '../../crypto/xchacha20poly1305-decrypt';
import { uploadFileFromStream } from '../../skynet/skynet';
import Xchacha20poly1305Encrypt from '../../crypto/xchacha20poly1305-encrypt';
import { getEndpointInCurrentPortal } from '../../portals';

export const webWorkerDownload = async (
  encryptedFile: IEncryptedFile,
  setDecryptProgress,
  setDownloadProgress
): Promise<string> => {
  const worker = new Worker(WEB_WORKER_URL);
  const service = wrap<WorkerApi>(worker);

  const url = await service.decryptFile(
    encryptedFile,
    getEndpointInCurrentPortal(),
    proxy(setDecryptProgress),
    proxy(setDownloadProgress)
  );
  if (url.startsWith('error')) {
    message.error(url);
    return;
  }

  return url;
};

export const simpleDownload = async (
  encryptedFile: IEncryptedFile,
  setDecryptProgress,
  setDownloadProgress
): Promise<string> => {
  const decrypt = new Xchacha20poly1305Decrypt(
    encryptedFile,
    getEndpointInCurrentPortal()
  );

  let file: File;
  try {
    file = await decrypt.decrypt(
      (completed, eProgress) => {
        setDecryptProgress(eProgress);
      },
      (completed, dProgress) => {
        setDownloadProgress(dProgress);
      }
    );
  } catch (error) {
    message.error(error.message);
  }

  if (!file) {
    return;
  }

  return window.URL.createObjectURL(file);
};

export const webWorkerUploader = async (
  options,
  fileKey,
  setEncryptProgress
): Promise<void> => {
  const { onSuccess, onError, file, onProgress } = options;

  const worker = new Worker(WEB_WORKER_URL);
  const service = wrap<WorkerApi>(worker);

  await service.initEncryptionReader(file, fileKey, proxy(setEncryptProgress));

  const rs = new ReadableStream({
    async start(controller) {
      const enc = await service.readChunk();
      controller.enqueue(enc.value);
    },
    async pull(controller) {
      const enc = await service.readChunk();
      if (!enc.done) {
        controller.enqueue(enc.value);
      } else {
        controller.close();
      }
    },
  });

  const streamSize = await service.getStreamSize();

  await uploadFileFromStream(
    fileKey,
    streamSize,
    rs,
    onProgress,
    onSuccess,
    onError
  );

  worker.terminate();
};

export const simpleUploader = async (
  options,
  fileKey,
  setEncryptProgress
): Promise<void> => {
  const { onSuccess, onError, file, onProgress } = options;

  const fe = new Xchacha20poly1305Encrypt(file, fileKey);
  await fe.encryptAndStream((completed, eProgress) => {
    setEncryptProgress(eProgress);
  });

  const stream = await fe.getStream(TUS_CHUNK_SIZE);

  await uploadFileFromStream(
    fileKey,
    fe.getStreamSize(),
    stream,
    onProgress,
    onSuccess,
    onError
  );
};

export const downloadFile = async (
  encryptedFile: IEncryptedFile,
  setDecryptProgress,
  setDownloadProgress
) => {
  const fileName: string = encryptedFile.name;
  let fileUrl: string;

  if (window.Worker) {
    console.log('[Using web-workers]');
    fileUrl = await webWorkerDownload(
      encryptedFile,
      setDecryptProgress,
      setDownloadProgress
    );
  } else {
    fileUrl = await simpleDownload(
      encryptedFile,
      setDecryptProgress,
      setDownloadProgress
    );
  }

  const elem = window.document.createElement('a');
  elem.href = fileUrl;
  elem.download = fileName;
  document.body.appendChild(elem);
  elem.click();
  document.body.removeChild(elem);
};
