const messages = {
  dns: '无法解析服务地址，请检查设备的 DNS 设置后重试',
  tls: '无法建立安全连接，请检查设备日期时间或系统更新后重试',
  timeout: '连接服务超时，请稍后重试',
  offline: '无法连接服务，请稍后重试',
} as const;

/** Only finite native failure categories cross the bridge; no raw URL or TLS messages. */
export class ConnectionFailure extends Error {
  constructor(readonly kind: keyof typeof messages) {
    super(messages[kind]);
    this.name = 'ConnectionFailure';
  }
}

export function connectionFailure(kind: unknown): ConnectionFailure | undefined {
  if (typeof kind !== 'string' || !Object.hasOwn(messages, kind)) return undefined;
  return new ConnectionFailure(kind as keyof typeof messages);
}
