import './uploader.css';

import { useState, useRef, useEffect } from 'react';

import { EncryptedFileReference } from '../../models/encryption';

import { isMobile } from 'react-device-detect';

import { v4 as uuid } from 'uuid';

import {
  Button,
  Alert,
  message,
  Upload,
  Spin,
  Tree,
  Empty,
  Divider,
  Modal,
} from 'antd';

import {
  DownloadOutlined,
  DownOutlined,
  LoadingOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';

import { UploadFile } from 'antd/lib/upload/interface';

import { renderTree } from '../../utils/walker';
import AESFileEncrypt from '../../crypto/file-encrypt';
import AESFileDecrypt from '../../crypto/file-decrypt';
import {
  DEFAULT_ENCRYPTION_TYPE,
  MAX_PARALLEL_UPLOAD,
  MIN_SKYDB_SYNC_FACTOR,
  SKYDB_SYNC_FACTOR,
} from '../../config';
import { TabsCards } from '../common/tabs-cards';
import { ActivityBars } from './activity-bar';

import SessionManager from '../../session/session-manager';
import { deriveEncryptionKeyFromKey } from '../../crypto/crypto';

import {
  getEncryptedFiles,
  storeEncryptedFiles,
  uploadFile,
} from '../../skynet/skynet';
import { DraggerContent } from './dragger-content';
import { ShareModal } from '../common/share-modal';
import { getEndpointInDefaultPortal } from '../../portals';
import { DirectoryTreeLine } from '../common/directory-tree-line/directory-tree-line';

const { DirectoryTree } = Tree;
const { Dragger } = Upload;
const { DownloadActivityBar, UploadActivityBar } = ActivityBars;

const useConstructor = (callBack = () => {}) => {
  const hasBeenCalled = useRef(false);
  if (hasBeenCalled.current) return;
  callBack();
  hasBeenCalled.current = true;
};

const sleep = (ms): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

let uploadCount = 0;
let skydbSyncInProgress = false;

const Uploader = () => {
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadedEncryptedFiles, setUploadedEncryptedFiles] = useState<
    EncryptedFileReference[]
  >([]);

  const [toStoreInSkyDBCount, setToStoreInSkyDBCount] = useState(0);
  const [toRemoveFromSkyDBCount, setToRemoveFromSkyDBCount] = useState(0);

  const [uploading, setUploading] = useState(false);
  const [showUploadCompletedModal, setShowUploadCompletedModal] = useState(
    false
  );
  const [loading, setLoading] = useState(true);
  const [uidsOfErrorFiles, setUidsOfErrorFiles] = useState<string[]>([]);
  const [fileListToUpload, setFileListToUpload] = useState<UploadFile[]>([]);

  const finishUpload = () => {
    setShowUploadCompletedModal(false);
  };

  const initSession = async () => {
    const files = await getEncryptedFiles(
      SessionManager.sessionPublicKey,
      deriveEncryptionKeyFromKey(SessionManager.sessionPrivateKey)
    );
    if (!files) {
      setLoading(false);
      return;
    }

    setUploadedEncryptedFiles((prev) => [...prev, ...files]);
    setLoading(false);
  };

  const updateFilesInSkyDB = async () => {
    setLoading(true);
    skydbSyncInProgress = true;
    try {
      message.loading('Syncing files in SkyDB...');
      await storeEncryptedFiles(
        SessionManager.sessionPrivateKey,
        deriveEncryptionKeyFromKey(SessionManager.sessionPrivateKey),
        uploadedEncryptedFiles
      );

      message.success('Sync completed');
      setToStoreInSkyDBCount(0);
      setToRemoveFromSkyDBCount(0);
    } catch (error) {
      setErrorMessage('Could not sync session encrypted files: ' + error);
    }

    skydbSyncInProgress = false;
    setLoading(false);
  };

  const skyDBSyncer = async () => {
    const stillInProgressFilesCount =
      fileListToUpload.length - uidsOfErrorFiles.length;

    const intervalSkyDBSync =
      toStoreInSkyDBCount > SKYDB_SYNC_FACTOR &&
      stillInProgressFilesCount > MIN_SKYDB_SYNC_FACTOR;

    const uploadCompletedSkyDBSync =
      toStoreInSkyDBCount > 0 &&
      uploadedEncryptedFiles.length > 0 &&
      stillInProgressFilesCount === 0;

    const fileListEditedSkyDBSync =
      toRemoveFromSkyDBCount > 0 && stillInProgressFilesCount === 0;

    if (stillInProgressFilesCount === 0 && toStoreInSkyDBCount === 0) {
      setUploading(false);
    }

    if (
      !skydbSyncInProgress &&
      (intervalSkyDBSync || uploadCompletedSkyDBSync || fileListEditedSkyDBSync)
    ) {
      await updateFilesInSkyDB();

      if (uploadCompletedSkyDBSync) {
        setShowUploadCompletedModal(true);
      }
    }
  };

  useConstructor(() => {
    initSession();
  });

  useEffect(() => {
    skyDBSyncer();
  });

  const [downloadProgress, setDownloadProgress] = useState(0);
  const [decryptProgress, setDecryptProgress] = useState(0);
  const [encryptProgress, setEncryptProgress] = useState(0);

  useEffect(() => {
    if (downloadProgress === 100) {
      setTimeout(() => {
        setDownloadProgress(0);
      }, 500);
    }
  }, [downloadProgress]);

  useEffect(() => {
    if (decryptProgress === 100) {
      setTimeout(() => {
        setDecryptProgress(0);
      }, 500);
    }
  }, [decryptProgress]);

  useEffect(() => {
    if (encryptProgress === 100) {
      setTimeout(() => {
        setEncryptProgress(0);
      }, 500);
    }
  }, [encryptProgress]);

  const downloadFile = async (encryptedFile: EncryptedFileReference) => {
    const decrypt = new AESFileDecrypt(
      encryptedFile,
      deriveEncryptionKeyFromKey(SessionManager.sessionPrivateKey)
    );

    const file: File = await decrypt.decrypt(
      (completed, eProgress) => {
        setDecryptProgress(eProgress);
      },
      (completed, dProgress) => {
        setDownloadProgress(dProgress);
      }
    );

    if (window.navigator.msSaveOrOpenBlob) {
      window.navigator.msSaveBlob(file, encryptedFile.fileName);
    } else {
      var elem = window.document.createElement('a');
      elem.href = window.URL.createObjectURL(file);
      elem.download = file.name;
      document.body.appendChild(elem);
      elem.click();
      document.body.removeChild(elem);
    }
  };

  const queueParallelEncryption = (file: File): Promise<File> => {
    return new Promise(async (resolve) => {
      while (uploadCount > MAX_PARALLEL_UPLOAD) {
        await sleep(1000);
      }

      uploadCount++;

      const fe = new AESFileEncrypt(
        file,
        deriveEncryptionKeyFromKey(SessionManager.sessionPrivateKey)
      );
      resolve(
        fe.encrypt((completed, eProgress) => {
          setEncryptProgress(eProgress);
        })
      );
    });
  };

  const queueAndUploadFile = async (options) => {
    const { onSuccess, onError, file, onProgress } = options;
    const encryptedFile = await queueParallelEncryption(file);
    await uploadFile(encryptedFile, onProgress, onSuccess, onError);
  };

  const draggerConfig = {
    name: 'file',
    multiple: true,
    action: getEndpointInDefaultPortal(),
    fileList: fileListToUpload,
    directory: !isMobile,
    showUploadList: {
      showRemoveIcon: true,
    },
    customRequest: queueAndUploadFile,
    openFileDialogOnClick: true,
    onChange(info) {
      setShowUploadCompletedModal(false);
      setUploading(true);

      setFileListToUpload(info.fileList.map((x) => x)); // Note: A new object must be used here!!!

      const { status } = info.file;

      // error | success | done | uploading | removed
      switch (status) {
        case 'removed': {
          if (
            uidsOfErrorFiles.findIndex((uid) => uid === info.file.uid) === -1
          ) {
            uploadCount--;
          }
          setUidsOfErrorFiles((p) => p.filter((uid) => uid !== info.file.uid));
          setFileListToUpload((prev) =>
            prev.filter((f) => f.uid !== info.file.uid)
          );
          break;
        }
        case 'error': {
          uploadCount--;
          setUidsOfErrorFiles((p) => [...p, info.file.uid]);
          message.error(`${info.file.name} file upload failed.`);
          break;
        }
        case 'done': {
          const relativePath = info.file.originFileObj.webkitRelativePath
            ? info.file.originFileObj.webkitRelativePath
            : info.file.name;

          const tempFile: EncryptedFileReference = {
            uuid: uuid(),
            skylink: info.file.response.data.skylink,
            encryptionType: DEFAULT_ENCRYPTION_TYPE,
            fileName: info.file.name,
            mimeType: info.file.type,
            relativePath: relativePath,
            size: info.file.size,
            encryptedSize: info.file.response.encryptedFileSize,
          };

          message.success(`${info.file.name} file uploaded successfully.`);

          setUploadedEncryptedFiles((prev) => [
            // overwrite if there is an old file with the same relativePath
            ...prev.filter((f) => f.relativePath !== tempFile.relativePath),
            tempFile,
          ]);
          setToStoreInSkyDBCount((prev) => prev + 1);
          uploadCount--;
          setFileListToUpload((prev) =>
            prev.filter((f) => f.uid !== info.file.uid)
          );
          break;
        }
      }
    },
  };

  const deleteConfirmModal = (filename: string, onDeleteClick: () => void) => {
    Modal.confirm({
      title: 'Warning',
      icon: <QuestionCircleOutlined />,
      content: `File ${filename} will be deleted. Are you sure?`,
      okText: 'Delete',
      cancelText: 'Cancel',
      onOk: onDeleteClick,
    });
  };

  const loaderIcon = (
    <LoadingOutlined style={{ fontSize: 24, color: '#20bf6b' }} spin />
  );

  const isLoading = uploading || loading;
  return (
    <>
      {errorMessage ? (
        <Alert
          className="error-message"
          message={errorMessage}
          type="error"
          showIcon
        />
      ) : (
        ''
      )}

      <TabsCards
        tabType="line"
        values={[
          {
            name: 'Upload file(s)',
            content: (
              <div style={{ paddingBottom: '4px' }}>
                <Dragger
                  className="drop-container"
                  {...draggerConfig}
                  directory={false}
                  multiple
                  disabled={uploading}
                >
                  <DraggerContent
                    onlyClickable={isMobile}
                    draggableMessage="Drag & Drop file(s) to upload"
                  />
                  <UploadActivityBar encryptProgress={encryptProgress} />
                </Dragger>
              </div>
            ),
          },
          {
            name: 'Upload directory',
            content: (
              <div style={{ paddingBottom: '4px' }}>
                <Dragger
                  className="drop-container"
                  {...draggerConfig}
                  directory={true}
                  disabled={uploading}
                >
                  <DraggerContent
                    onlyClickable={isMobile}
                    draggableMessage="Drag & Drop directory here to upload"
                  />
                  <UploadActivityBar encryptProgress={encryptProgress} />
                </Dragger>
              </div>
            ),
          },
        ]}
      />

      {uploadedEncryptedFiles.length > 0 ? (
        <div className="file-list default-margin">
          <DownloadActivityBar
            decryptProgress={decryptProgress}
            downloadProgress={downloadProgress}
          />
          {isLoading && (
            <div style={{ textAlign: 'center' }}>
              <Spin style={{ marginRight: '8px' }} indicator={loaderIcon} />
              Sync in progress...
            </div>
          )}
          <Divider>Uploaded files</Divider>
          <DirectoryTree
            multiple
            showIcon={false}
            showLine
            className="file-tree default-margin"
            disabled={isLoading}
            defaultExpandAll={true}
            switcherIcon={<DownOutlined className="directory-switcher" />}
            treeData={renderTree(uploadedEncryptedFiles)}
            selectable={false}
            titleRender={(node) => (
              <DirectoryTreeLine
                disabled={isLoading}
                isLeaf={node.isLeaf}
                name={node.title.toString()}
                onDownloadClick={() => {
                  if (!node.isLeaf) {
                    return;
                  }
                  const key: string = `${node.key}`;
                  const toDownload = uploadedEncryptedFiles.find(
                    (f) => f.uuid === key.split('_')[0]
                  );
                  if (toDownload) {
                    message.loading(`Download and decryption started`);
                    downloadFile(toDownload);
                  }
                }}
                onDeleteClick={() => {
                  deleteConfirmModal(node.title.toString(), () => {
                    const key: string = `${node.key}`;
                    setUploadedEncryptedFiles((prev) =>
                      prev.filter((f) => f.uuid !== key.split('_')[0])
                    );
                    setToRemoveFromSkyDBCount((prev) => prev + 1);
                  });
                }}
              />
            )}
          />
        </div>
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="">
          {loading ? <Spin /> : <span>No uploaded data</span>}
        </Empty>
      )}

      {!isLoading && uploadedEncryptedFiles.length > 0 && (
        <div style={{ textAlign: 'center' }}>
          <Button
            icon={<DownloadOutlined />}
            size="large"
            onClick={async () => {
              message.loading(`Download and decryption started`);
              for (const encyptedFile of uploadedEncryptedFiles) {
                await downloadFile(encyptedFile);
              }
            }}
          >
            Download all files
          </Button>
        </div>
      )}
      <ShareModal
        title="Upload completed"
        visible={showUploadCompletedModal}
        onCancel={() => {
          setShowUploadCompletedModal(false);
        }}
        header={
          <p>
            Your <strong>SkyTransfer</strong> is ready. Your files have been
            encrypted and uploaded on Skynet. Copy the link and share your files
            or just continue uploading. When you share a draft, others can add
            files to your SkyTransfer.
          </p>
        }
        shareLinkOnClick={finishUpload}
        shareDraftLinkOnClick={finishUpload}
      />
    </>
  );
};

export default Uploader;
