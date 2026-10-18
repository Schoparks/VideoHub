import { useControllerPairing } from '../hooks/useControllerPairing';
import './phone-controller-setting.css';

export function PhoneControllerSetting() {
  const pairing = useControllerPairing();
  if (!pairing.supported) return <p className="device-status">手机遥控需在应用中使用</p>;
  const { status, busy, error } = pairing;
  return (
    <section className="phone-controller-setting">
      {error && <p className="error-message" role="alert">{error}</p>}
      {status.enabled && <div className="phone-pairing">
        <div className="phone-qr">{pairing.image && <img src={pairing.image} alt="手机遥控二维码" />}</div>
        <div>
          <p>手机连接同一局域网后扫码访问</p>
          <p className="small muted">扫码者可控制播放</p>
          {status.urls.length > 1 && <label>连接地址
            <select aria-label="遥控连接地址" value={pairing.index} onChange={event => pairing.setIndex(Number(event.target.value))}>
              {status.urls.map((url, index) => <option key={url} value={index}>{new URL(url).host}</option>)}
            </select>
          </label>}
          <p className="small phone-address">{pairing.url.split('#')[0]}</p>
        </div>
      </div>}
      {!status.enabled && <button aria-disabled={busy || undefined} data-focus-retain={busy || undefined}
        onClick={() => { if (!busy) void pairing.enable(true); }}>重新连接</button>}
    </section>
  );
}
