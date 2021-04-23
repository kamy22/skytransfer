import { useRef, useState } from 'react';
import { getUserPublicSessions, storeUserSession } from '../../skynet/skynet';

import { Form, Input, Button, Divider } from 'antd';
import { PublicSession } from '../../models/session';

import { List } from 'antd';

import { v4 as uuid } from 'uuid';

const useConstructor = (callBack = () => {}) => {
  const hasBeenCalled = useRef(false);
  if (hasBeenCalled.current) return;
  callBack();
  hasBeenCalled.current = true;
};

const Account = () => {
  const [userSessions, setUserSessions] = useState<PublicSession[]>([]);

  useConstructor(async () => {
    setUserSessions(await getUserPublicSessions());
  });

  const onFinish = async (values: any) => {
    const session: PublicSession = {
      id: uuid(),
      name: values.sessionName,
      link: values.sessionLink,
      createdAt: new Date().getTime(),
    };
    setUserSessions((p) => [...p, session]);
    await storeUserSession([session]);
  };

  return (
    <>
      <Divider orientation="left">
        Create and public a new SkyTransfer session
      </Divider>
      <Form name="basic" onFinish={onFinish}>
        <Form.Item
          name="sessionName"
          rules={[{ required: true, message: 'Please add a session name' }]}
        >
          <Input placeholder="Session name" />
        </Form.Item>

        <Form.Item
          name="sessionLink"
          rules={[{ required: true, message: 'Please add a session link' }]}
        >
          <Input placeholder="Session link" />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit">
            Public
          </Button>
        </Form.Item>
      </Form>
      <Divider orientation="left">Public SkyTransfer sessions</Divider>
      <List
        bordered
        dataSource={userSessions}
        renderItem={(item) => (
          <List.Item>
            <a href={item.link}>{item.name}</a>
          </List.Item>
        )}
      />
    </>
  );
};

export default Account;
