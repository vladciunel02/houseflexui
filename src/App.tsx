import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLIENT_TODAY,
  CLIENT_TOMORROW,
  hhmm,
  simulate,
} from './data/mockFleet';
import { cancelledStrategy } from './data/derive';
import { timeStore, useMinute } from './state/time';
import { HouseView } from './views/HouseView';

const DAY_SECONDS = 24;

export default function App() {
  const [playing, setPlaying] = useState(false);
  const [cancelledAtMin, setCancelledAtMin] = useState<number | null>(null);
  const [cloudStart, setCloudStart] = useState<number | null>(null);

  // ---- playback: whole day in ~24 s, driven from Demo Controls ----
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      if (last.current != null) {
        const dt = (now - last.current) / 1000;
        timeStore.set(timeStore.get() + (dt * 1440) / DAY_SECONDS);
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const activeSim = useMemo(
    () =>
      cancelledAtMin != null
        ? cancelledStrategy(CLIENT_TODAY, cancelledAtMin, cloudStart)
        : simulate(CLIENT_TODAY, 'homeflex', cloudStart),
    [cancelledAtMin, cloudStart],
  );

  const handleSimulateCloud = useCallback(() => {
    setCloudStart(Math.round(timeStore.get()));
  }, []);

  return (
    <div className="app">
      <header className="header-surface">
        <div className="header-brand-group">
          <div className="brand-inline">
            <span className="wordmark">HomeFlex</span>
            <span className="wordmark-sub">în myPPC</span>
          </div>
          <span className="header-sep" aria-hidden="true" />
          <span className="header-place">{CLIENT_TODAY.address}</span>
        </div>

        <HeaderClock />
      </header>

      <main className="page-main">
        <HouseView
          today={CLIENT_TODAY}
          tomorrow={CLIENT_TOMORROW}
          activeSim={activeSim}
          cancelledAtMin={cancelledAtMin}
          cloudStart={cloudStart}
          onConfirmCancel={(atMin) => setCancelledAtMin(atMin)}
          onReactivate={() => setCancelledAtMin(null)}
        />
      </main>

      <footer className="page-footer">
        Concept HomeFlex pentru clienții PPC. Date simulate.
      </footer>

      <DemoControls
        playing={playing}
        onTogglePlay={() => setPlaying((p) => !p)}
        onPause={() => setPlaying(false)}
        onSimulateCloud={handleSimulateCloud}
      />
    </div>
  );
}

function HeaderClock() {
  const minute = useMinute();
  return <div className="header-clock tnum">Acum, {hhmm(Math.floor(minute))}</div>;
}

function DemoControls({
  playing,
  onTogglePlay,
  onPause,
  onSimulateCloud,
}: {
  playing: boolean;
  onTogglePlay: () => void;
  onPause: () => void;
  onSimulateCloud: () => void;
}) {
  const [open, setOpen] = useState(false);
  const minute = useMinute();
  const displayMin = Math.floor(minute);

  if (!open) {
    return (
      <aside className="demo-bar collapsed" aria-label="Controale demo">
        <button
          type="button"
          className="demo-toggle-btn"
          aria-expanded="false"
          onClick={() => setOpen(true)}
        >
          Controale demo
        </button>
      </aside>
    );
  }

  return (
    <aside className="demo-bar expanded" aria-label="Controale demo">
      <div className="demo-bar-head">
        <span className="demo-title">Controale demo</span>
        <button
          type="button"
          className="btn-tertiary on-dark demo-close"
          aria-expanded="true"
          onClick={() => setOpen(false)}
        >
          Închide
        </button>
      </div>

      <label className="demo-slider-row tnum">
        <span>Ora simulată: {hhmm(displayMin)}</span>
        <input
          type="range"
          className="demo-slider"
          min={0}
          max={1439}
          step={5}
          value={displayMin}
          aria-label="Ora simulată"
          onChange={(e) => {
            onPause();
            timeStore.set(Number(e.target.value));
          }}
        />
        <div className="demo-slider-ticks">
          <span>00:00</span>
          <span>12:00</span>
          <span>24:00</span>
        </div>
      </label>

      <div className="demo-actions">
        <button
          type="button"
          className="demo-action-btn"
          aria-pressed={playing}
          onClick={onTogglePlay}
        >
          {playing ? 'Pauză' : 'Redă ziua'}
        </button>
        <button type="button" className="demo-action-btn" onClick={onSimulateCloud}>
          Simulează un nor
        </button>
      </div>
    </aside>
  );
}
