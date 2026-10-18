import { native } from './native';
import type { ControllerReply, ControllerStatus } from '../../src/shared/remote-control';

function status(json: string): ControllerStatus {
  const value = JSON.parse(json);
  if (value.error) throw new Error(value.error);
  return value;
}

export const controllerApi = {
  controllerStatus: async () => status(native.controllerStatus()),
  controllerEnable: async (enabled: boolean) => status(native.controllerEnable(enabled)),
  controllerReply: async (id: string, reply: ControllerReply) => native.controllerReply(id, JSON.stringify(reply)),
};
