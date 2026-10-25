import type { CompanionCard, CompanionDynamic } from '../shared/companion';
import { PhoneCover } from './PhoneCover';
import { PhoneMediaList } from './PhoneMediaList';
import './phone-dynamics.css';

export function PhoneDynamics({ entries, play, busy }: {
  entries: CompanionDynamic[]; play: (item: CompanionCard) => void; busy: boolean;
}) {
  return <div className="phone-dynamics">{entries.map(entry => <article key={entry.handle}>
    {entry.blocks.map((body, index) => <section key={index} className={index ? 'phone-dynamic-original' : undefined}>
      <h3>{body.author}</h3>
      {body.text && <p>{body.text}</p>}
      {!!body.images.length && <div className="phone-dynamic-images">{body.images.map(handle =>
        <PhoneCover key={handle} item={{ handle, artwork: true, kind: 'video', source: 'bilibili' }} />)}</div>}
      {body.video && <PhoneMediaList items={[body.video]} busy={busy} play={play} />}
    </section>)}
  </article>)}</div>;
}
