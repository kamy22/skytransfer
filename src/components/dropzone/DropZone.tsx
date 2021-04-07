import './DropZone.css';

import { useState, useEffect, useRef } from 'react';
import { SkynetClient, genKeyPairAndSeed } from 'skynet-js';
import { EncryptionType, FileEncrypted } from '../../models/encryption';
import FileUtils from '../../utils/file';

import { Button, Row, Empty, List, Divider, Alert, message, Modal, Progress, Menu } from 'antd';
import { CloudUploadOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';


const SESSION_KEY_NAME = 'sessionKey';
const skynetClient = new SkynetClient('https://ilkamo.hns.siasky.net');

const useConstructor = (callBack = () => { }) => {
  const hasBeenCalled = useRef(false);
  if (hasBeenCalled.current) return;
  callBack();
  hasBeenCalled.current = true;
};

const DropZone = () => {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [validFiles, setValidFiles] = useState([]);
  const [sessionPublicKey, setSessionPublicKey] = useState('');
  const [sessionPrivateKey, setSessionPrivateKey] = useState('');
  const [uploadedEncryptedFiles, setUploadedEncryptedFiles] = useState<FileEncrypted[]>([]);
  const [sessionInterval, setSessionInterval] = useState(
    setTimeout(() => { }, 0)
  );
  const [uploading, setUploading] = useState(false);
  const [uploaCompleted, setUploaCompleted] = useState(false);
  const [uploadPercentage, setUploadPercentage] = useState(0);
  const [loading, setlLoading] = useState(true);

  const fileUtils: FileUtils = new FileUtils();
  const [encryptionKey, setEncryptionKey] = useState('');

  const publicKeyFromPrivateKey = (privateKey: string): string => {
    return privateKey.substr(privateKey.length - 64);
  };

  const initSession = async () => {
    const sessionKey = localStorage.getItem(SESSION_KEY_NAME);
    if (sessionKey) {
      setSessionPublicKey(publicKeyFromPrivateKey(sessionKey));
      setSessionPrivateKey(sessionKey);
      setEncryptionKey(fileUtils.generateEncryptionKey(sessionKey));

      const files = await fileUtils.getSessionEncryptedFiles(publicKeyFromPrivateKey(sessionKey));
      if (!files) {
        setlLoading(false);
        return;
      }

      setUploadedEncryptedFiles((prev) => [...prev, ...files]);
      setlLoading(false);
    } else {
      const { publicKey, privateKey } = genKeyPairAndSeed();
      setSessionPublicKey(publicKey);
      setSessionPrivateKey(privateKey);
      setEncryptionKey(fileUtils.generateEncryptionKey(privateKey));
      localStorage.setItem(SESSION_KEY_NAME, privateKey);
    }
  };

  useConstructor(() => {
    initSession();
  });

  const dragOver = (e) => {
    e.preventDefault();
  };

  const dragEnter = (e) => {
    e.preventDefault();
  };

  const dragLeave = (e) => {
    e.preventDefault();
  };

  const fileDrop = (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length) {
      handleFiles(files);
    }
  };

  const handleFiles = (files) => {
    for (let i = 0; i < files.length; i++) {
      setSelectedFiles((prevArray) => [...prevArray, files[i]]);
    }
  };

  useEffect(() => {
    let filteredArray = selectedFiles.reduce((file, current) => {
      const x = file.find((item) => item.name === current.name);
      if (x === undefined) {
        return file.concat([current]);
      } else {
        return file;
      }
    }, []);
    setValidFiles([...filteredArray]);
  }, [selectedFiles]);

  const removeFile = (name) => {
    setSelectedFiles(selectedFiles.filter((e) => e.name !== name));
  };

  const fileInputRef = useRef(null);

  const fileInputClicked = () => {
    fileInputRef.current.click();
  };

  const uploadFiles = async () => {
    setUploadPercentage(0);
    setUploaCompleted(false);
    const toUpload: FileEncrypted[] = uploadedEncryptedFiles.map((x) => x); // working on copy
    setUploading(true);

    for (let i = 0; i < validFiles.length; i++) {
      try {
        const result = await fileUtils.encryptFile(encryptionKey, validFiles[i]);
        const { skylink } = await skynetClient.uploadFile(result);

        const tempFile = {
          skylink: skylink,
          encryptionType: EncryptionType.AES,
          fileName: validFiles[i].name,
          mimeType: validFiles[i].type,
          size: validFiles[i].size
        }

        setUploadedEncryptedFiles((prevArray) => [...prevArray, tempFile]);
        setSelectedFiles((p) => p.filter(f => f.name !== validFiles[i].name));

        setUploadPercentage(Math.ceil((i + 1 / validFiles.length) * 100));

        toUpload.push(tempFile);
      } catch (error) {
        setErrorMessage('Could not upload file: ' + error);
      }
    }

    clearTimeout(sessionInterval);
    setSessionInterval(
      setTimeout(async () => {
        if (toUpload.length === 0) {
          setUploading(false);
          setUploaCompleted(true);
          setUploadPercentage(100);
          return;
        }

        try {
          message.loading("Storing files in SkyDB...")
          await fileUtils.storeSessionEncryptedFiles(sessionPrivateKey, toUpload);
          setUploadPercentage(100);
          message.success("Upload completed")
        } catch (error) {
          setErrorMessage('Could not store session encrypted files: ' + error);
        }

        setUploaCompleted(true);
        setUploading(false);
      }, 2000)
    );
  };

  const filesSelected = () => {
    if (fileInputRef.current.files.length) {
      handleFiles(fileInputRef.current.files);
    }
  };

  const getFileListLink = () => {
    return `${window.location.hostname}/#/${sessionPublicKey}/${encryptionKey}`;
  }

  const copyFileListLink = () => {
    navigator.clipboard.writeText(getFileListLink());
    setUploaCompleted(false);
    message.info("Link copied");
  }

  const startUpload = () => {
    message.loading('File encryption and upload started', 5);
  };

  const destroySession = () => {
    localStorage.removeItem(SESSION_KEY_NAME);
    window.location.reload();
  }

  const downloadFile = async (encryptedFile: FileEncrypted) => {
    const file: File = await fileUtils.decryptFile(encryptionKey, encryptedFile);

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

  return (
    <div className="container">
      <Menu className="default-margin" selectedKeys={[]} mode="horizontal">
        <Menu.Item key="copy" onClick={copyFileListLink} icon={<CopyOutlined />}>
          Copy SkyTransfer link
        </Menu.Item>
        <Menu.Item key="new-session" onClick={destroySession} icon={<DeleteOutlined />}>
          New session
        </Menu.Item>
        <Menu.Item key="about-us" disabled icon={<CopyOutlined />}>
          About SkyTransfer
        </Menu.Item>
      </Menu>
      {errorMessage ? (
        <Alert className="error-message" message={errorMessage} type="error" showIcon />
      ) : (
        ''
      )}
      <div
        className="drop-container"
        onDragOver={dragOver}
        onDragEnter={dragEnter}
        onDragLeave={dragLeave}
        onDrop={fileDrop}
        onClick={fileInputClicked}>
        <Empty
          image="https://gw.alipayobjects.com/zos/antfincdn/ZHrcdLPrvN/empty.svg"
          imageStyle={{
            height: 60,
          }}
          description={<span>
            Drag & Drop files here or click to upload
          </span>}
        >
        </Empty>
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          multiple
          onChange={filesSelected}
        />
      </div>
      {uploading ? (
        <Row justify="center" align="middle">
          <Progress percent={uploadPercentage} />
        </Row>
      ) : (
        ''
      )}
      <Row justify="center" align="middle">
        {validFiles.length ? (
          <Button
            icon={<CloudUploadOutlined />}
            type="primary"
            loading={uploading}
            onClick={() => { startUpload(); uploadFiles() }}
          >
            Upload Files
          </Button>
        ) : (
          ''
        )}
      </Row>
      {validFiles.length > 0 ? (
        <div>
          <Divider orientation="left">Selected files</Divider>
          <List
            bordered={true}
            loading={uploading}
            itemLayout="horizontal"
            dataSource={validFiles}
            renderItem={item => (
              <List.Item
                actions={[
                  <Button onClick={() => removeFile(item.name)} type="link" danger key="list-remove">remove</Button>]}
              >
                <List.Item.Meta
                  description={fileUtils.fileSize(item.size)}
                  title={item.name}
                />
                {/* {item.invalid && (
                  <span className="file-error-message">({errorMessage})</span>
                )} */}
              </List.Item>
            )}
          />
        </div>
      ) : (
        ''
      )}

      <div>
        <Divider orientation="left">Uploaded files</Divider>
        <List
          bordered={true}
          loading={uploading || loading}
          itemLayout="horizontal"
          dataSource={uploadedEncryptedFiles}
          renderItem={item => (
            <List.Item
              actions={[
                <Button onClick={() => {
                  message.loading(`Download and decryption started`);
                  downloadFile(item);
                }} type="link" key="list-download">download</Button>]}
            >
              <List.Item.Meta
                description={fileUtils.fileSize(item.size)}
                title={item.fileName}
              />
            </List.Item>
          )}
        />
      </div>

      <Modal
        title="Upload completed"
        centered
        visible={uploaCompleted}
        okText="Copy link"
        cancelText="Continue"
        onCancel={() => { setUploaCompleted(false); }}
        onOk={copyFileListLink}
      >
        <p>Your <strong>SkyTransfer</strong> is ready. Your files have been correctly encrytypted and uploaded on Skynet. Copy and share your SkyTransfer link or just continue uploading.</p>
      </Modal>
    </div>
  );
};
export default DropZone;
