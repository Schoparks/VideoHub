import { Check, Smartphone, Monitor, RefreshCw, ShieldCheck, LogOut } from 'lucide-react';
import type { AccountStatus } from '../shared/types';
import { useAccountLogin } from '../hooks/useAccountLogin';

interface AccountProps {
  account: AccountStatus;
  update: (account: AccountStatus) => void;
  notify: (message: string) => void;
}

export function Account({ account, update, notify }: AccountProps) {
  const { qr, status, busy, error, operation, start, logout } = useAccountLogin(update, notify);
  const refreshType = qr?.type || (operation === 'app' || operation === 'web' ? operation : undefined);

  return (
    <div className="account-content">
      {account.name && <p className="account-name">{account.name}</p>}
      <div className="auth-options">
        {(['app', 'web'] as const).map(type => (
          <button
            key={type}
            aria-disabled={busy || undefined} data-focus-retain
            className={`auth-option ${qr?.type === type ? 'selected' : ''}`}
            onClick={() => void start(type)}
          >
            {type === 'app' ? <Smartphone /> : <Monitor />}
            <span className="auth-copy">
              <b>{type === 'app' ? 'App 推荐授权' : '网页账号授权'}</b>
              <small>{type === 'app' ? '个性化推荐' : '动态 · 历史 · 收藏 · 播放权限'}</small>
            </span>
            {account[type] ? (
              <span className="auth-state success"><Check size={17} /> 已连接</span>
            ) : (
              <span className="pill">扫码连接</span>
            )}
          </button>
        ))}
      </div>
      {busy && (
        <div className="loading" role="status">
          <RefreshCw className="spin" /> {operation === 'logout' ? '正在断开账号…' : '正在生成二维码…'}
        </div>
      )}
      {refreshType && (
        <div className="qr-box">
          {qr && <img src={qr.image} alt="B 站登录二维码" />}
          {qr && <p role="status">{status}</p>}
          <button className="text-button" aria-disabled={busy || undefined} data-focus-retain onClick={() => void start(refreshType)}>
            <RefreshCw size={15} /> 刷新二维码
          </button>
        </div>
      )}
      {error && <p role="alert" className="error-message">{error}</p>}
      {account.warning && <p className="notice">{account.warning}</p>}
      <div className="security-note">
        <ShieldCheck size={19} />
        <span>
          {account.storage === 'encrypted'
            ? '凭证使用系统密钥环加密，仅保存在这台设备。'
            : '系统密钥环不可用时，授权仅在本次会话生效。'}
        </span>
      </div>
      {(account.app || account.web) && (
        <button
          className="text-button danger"
          aria-disabled={busy || undefined} data-focus-retain
          onClick={() => void logout()}
        >
          <LogOut size={16} /> 断开本机账号
        </button>
      )}
    </div>
  );
}
